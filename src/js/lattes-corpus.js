/* ==========================================================================
   BuscaBanca — Extrator do XML do Currículo Lattes
   --------------------------------------------------------------------------
   Lê o XML exportado pela Plataforma Lattes (CNPq) e extrai apenas o que
   interessa para medir a proximidade temática de uma pessoa com um trabalho:
   resumo do currículo, linhas de pesquisa, projetos, áreas do conhecimento,
   palavras-chave, títulos da formação, das produções e das orientações.

   Nomes de tags e atributos seguem o schema oficial CurriculoLattes (o mesmo
   usado pelo importador do lattesZen: js/lattes-xml.js). Como o currículo é
   quase todo em ATRIBUTOS, um varredor de tags por expressão regular basta,
   o que permite usar este mesmo arquivo no navegador e no Node (build.mjs),
   sem DOMParser e sem dependências.

   Dados de contato (e-mail, telefone, endereço) NÃO são extraídos.
   ========================================================================== */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.LattesCorpus = factory();
})(typeof self !== 'undefined' ? self : this, function () {

    /* ----------------------------- codificação ---------------------------- */
    // O Lattes exporta em ISO-8859-1; respeita o encoding declarado no cabeçalho.
    function decodeBuffer(buffer) {
        const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
        const head = new TextDecoder('ascii').decode(bytes.subarray(0, 200));
        const m = head.match(/encoding=["']([^"']+)["']/i);
        const enc = (m ? m[1] : 'utf-8').toLowerCase();
        try { return new TextDecoder(enc).decode(bytes); }
        catch (_) { return new TextDecoder('iso-8859-1').decode(bytes); }
    }

    /* --------------------------------- ZIP -------------------------------- */
    // A Plataforma Lattes entrega o XML dentro de um .zip (curriculo.xml).
    // Leitor mínimo: percorre o diretório central e descompacta as entradas
    // .xml (método 0 = sem compressão, 8 = deflate) com DecompressionStream,
    // disponível nos navegadores atuais e no Node 18+.
    function isZip(bytes) {
        return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
    }
    async function inflateRaw(bytes) {
        const ds = new DecompressionStream('deflate-raw');
        const out = new Response(new Blob([bytes]).stream().pipeThrough(ds));
        return new Uint8Array(await out.arrayBuffer());
    }
    async function xmlsDoZip(buffer) {
        const b = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
        const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
        let eocd = -1;
        for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
            if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
        }
        if (eocd < 0) throw new Error('arquivo ZIP inválido');
        const total = dv.getUint16(eocd + 10, true);
        let pos = dv.getUint32(eocd + 16, true);
        const saida = [];
        for (let n = 0; n < total; n++) {
            if (dv.getUint32(pos, true) !== 0x02014b50) break;
            const metodo = dv.getUint16(pos + 10, true);
            const tamComp = dv.getUint32(pos + 20, true);
            const lenNome = dv.getUint16(pos + 28, true);
            const lenExtra = dv.getUint16(pos + 30, true);
            const lenCom = dv.getUint16(pos + 32, true);
            const local = dv.getUint32(pos + 42, true);
            const nome = new TextDecoder().decode(b.subarray(pos + 46, pos + 46 + lenNome));
            pos += 46 + lenNome + lenExtra + lenCom;
            if (!/\.xml$/i.test(nome)) continue;
            const ini = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
            const dados = b.subarray(ini, ini + tamComp);
            if (metodo === 0) saida.push({ nome, bytes: dados });
            else if (metodo === 8) saida.push({ nome, bytes: await inflateRaw(dados) });
        }
        return saida;
    }
    // Lê um arquivo (.xml ou .zip) e devolve a lista de currículos encontrados.
    async function lerArquivo(nome, buffer) {
        const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
        const itens = isZip(bytes) ? await xmlsDoZip(bytes) : [{ nome, bytes }];
        return itens.map(it => parse(decodeBuffer(it.bytes), itens.length > 1 ? `${nome}/${it.nome}` : nome));
    }

    /* ------------------------------- helpers ------------------------------ */
    const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    function unescapeXml(s) {
        return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e) => {
            if (e[0] === '#') {
                const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
                return Number.isFinite(cp) ? String.fromCodePoint(cp) : all;
            }
            return ENT[e.toLowerCase()] ?? all;
        });
    }
    // Remove marcação HTML presente no resumo "rico" do currículo.
    function stripHtml(s) { return s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(); }

    const TAG_RE = /<([A-Z][A-Z0-9-]*)((?:\s+[A-Z0-9-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|<\/([A-Z][A-Z0-9-]*)\s*>/g;
    const ATTR_RE = /([A-Z0-9-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    function parseAttrs(src) {
        const o = {};
        if (!src) return o;
        ATTR_RE.lastIndex = 0;
        let m;
        while ((m = ATTR_RE.exec(src))) o[m[1]] = unescapeXml(m[2] ?? m[3] ?? '');
        return o;
    }
    function pick(o, keys) {
        for (const k of keys) if (o[k]) return o[k];
        return '';
    }

    const TITLE_KEYS = ['TITULO-DO-ARTIGO', 'TITULO-DO-LIVRO', 'TITULO-DO-CAPITULO-DO-LIVRO',
        'TITULO-DO-TRABALHO-TECNICO', 'TITULO-DO-TRABALHO', 'TITULO-DO-TEXTO', 'TITULO-DO-SOFTWARE',
        'TITULO-DO-PRODUTO', 'TITULO-DO-PROCESSO', 'TITULO-DA-APRESENTACAO', 'DENOMINACAO', 'TITULO'];
    const YEAR_KEYS = ['ANO-DO-ARTIGO', 'ANO-DO-TRABALHO', 'ANO-DO-TEXTO', 'ANO', 'ANO-DESENVOLVIMENTO',
        'ANO-DE-OBTENCAO-DO-TITULO', 'ANO-DE-CONCLUSAO'];

    // Titulações da formação acadêmica, da maior para a menor.
    const TITULACOES = [
        ['LIVRE-DOCENCIA', 'Livre-docência'], ['POS-DOUTORADO', 'Pós-doutorado'],
        ['DOUTORADO', 'Doutorado'], ['MESTRADO-PROFISSIONALIZANTE', 'Mestrado profissional'],
        ['MESTRADO', 'Mestrado'], ['ESPECIALIZACAO', 'Especialização'], ['GRADUACAO', 'Graduação'],
    ];
    const NIVEL = Object.fromEntries(TITULACOES.map(([tag], i) => [tag, TITULACOES.length - i]));

    // Seções cujos títulos descrevem a atuação da pessoa (e não de terceiros).
    function secaoDaProducao(stack) {
        for (let i = stack.length - 1; i >= 0; i--) {
            const t = stack[i];
            if (t === 'PRODUCAO-BIBLIOGRAFICA' || t === 'PRODUCAO-TECNICA' || t === 'OUTRA-PRODUCAO') {
                // Orientações ficam dentro de OUTRA-PRODUCAO, mas têm peso próprio.
                return stack.includes('ORIENTACOES-CONCLUIDAS') ? 'orientacoes' : 'producoes';
            }
            if (t === 'DADOS-COMPLEMENTARES') {
                if (stack.includes('ORIENTACOES-EM-ANDAMENTO')) return 'orientacoes';
                return null; // bancas, eventos, cursos: não entram no perfil temático
            }
        }
        return null;
    }

    /* ------------------------------- parse -------------------------------- */
    // Recebe o texto do XML e devolve um registro compacto da pessoa.
    function parse(xml, origem) {
        const p = {
            id: '', nome: '', origem: origem || '', atualizacao: '',
            instituicao: '', unidade: '', cidade: '', uf: '',
            titulacao: '', nivel: 0, bancasMestrado: 0, bancasDoutorado: 0,
            resumo: '', linhas: [], projetos: [], areas: [], palavrasChave: [],
            formacao: [], producoes: [], orientacoes: [],
        };
        const stack = [];
        const areas = new Set();
        const pcs = new Set();
        let encontrouRaiz = false;

        TAG_RE.lastIndex = 0;
        let m;
        while ((m = TAG_RE.exec(xml))) {
            if (m[4]) { // tag de fechamento
                const i = stack.lastIndexOf(m[4]);
                if (i >= 0) stack.length = i;
                continue;
            }
            const tag = m[1];
            const selfClosing = m[3] === '/';
            const a = parseAttrs(m[2]);

            if (tag === 'CURRICULO-VITAE') {
                encontrouRaiz = true;
                p.id = a['NUMERO-IDENTIFICADOR'] || '';
                const d = (a['DATA-ATUALIZACAO'] || '').replace(/\D/g, '');
                if (d.length === 8) p.atualizacao = `${d.slice(4, 8)}-${d.slice(2, 4)}-${d.slice(0, 2)}`;
            } else if (tag === 'DADOS-GERAIS') {
                p.nome = a['NOME-COMPLETO'] || '';
            } else if (tag === 'RESUMO-CV') {
                p.resumo = stripHtml(a['TEXTO-RESUMO-CV-RICO'] || '');
            } else if (tag === 'ENDERECO-PROFISSIONAL') {
                p.instituicao = a['NOME-INSTITUICAO-EMPRESA'] || '';
                p.unidade = a['NOME-UNIDADE'] || a['NOME-ORGAO'] || '';
                p.cidade = a['CIDADE'] || '';
                p.uf = a['UF'] || '';
            } else if (NIVEL[tag] && stack[stack.length - 1] === 'FORMACAO-ACADEMICA-TITULACAO') {
                const concluido = !a['STATUS-DO-CURSO'] || a['STATUS-DO-CURSO'] === 'CONCLUIDO';
                if (concluido && NIVEL[tag] > p.nivel) {
                    p.nivel = NIVEL[tag];
                    p.titulacao = TITULACOES.find(([t]) => t === tag)[1];
                }
                const titulo = a['TITULO-DA-DISSERTACAO-TESE'] || a['TITULO-DO-TRABALHO-DE-CONCLUSAO-DE-CURSO'] || a['TITULO-DO-TRABALHO'] || '';
                if (titulo) p.formacao.push({ t: titulo, a: a['ANO-DE-CONCLUSAO'] || '' });
            } else if (tag === 'LINHA-DE-PESQUISA') {
                const t = [a['TITULO-DA-LINHA-DE-PESQUISA'], a['OBJETIVOS-LINHA-DE-PESQUISA']].filter(Boolean).join('. ');
                if (t) p.linhas.push(t);
            } else if (tag === 'PROJETO-DE-PESQUISA') {
                const t = [a['NOME-DO-PROJETO'], a['DESCRICAO-DO-PROJETO']].filter(Boolean).join('. ');
                // Projeto sem ano de fim está em andamento: conta como atual.
                if (t) p.projetos.push({ t, a: a['ANO-FIM'] || (a['ANO-INICIO'] ? String(new Date().getFullYear()) : '') });
            } else if (/^AREA-DO-CONHECIMENTO-\d+$/.test(tag)) {
                for (const k of ['NOME-DA-AREA-DO-CONHECIMENTO', 'NOME-DA-SUB-AREA-DO-CONHECIMENTO', 'NOME-DA-ESPECIALIDADE']) {
                    if (a[k]) areas.add(a[k]);
                }
            } else if (tag === 'PALAVRAS-CHAVE') {
                for (let i = 1; i <= 6; i++) {
                    const v = (a[`PALAVRA-CHAVE-${i}`] || '').trim();
                    if (v) pcs.add(v);
                }
            } else if (tag === 'PARTICIPACAO-EM-BANCA-DE-MESTRADO') {
                p.bancasMestrado++;
            } else if (tag === 'PARTICIPACAO-EM-BANCA-DE-DOUTORADO') {
                p.bancasDoutorado++;
            } else if (tag.indexOf('DADOS-BASICOS') === 0) {
                const secao = secaoDaProducao(stack);
                const titulo = pick(a, TITLE_KEYS);
                if (secao && titulo) p[secao].push({ t: titulo, a: pick(a, YEAR_KEYS) });
            }

            if (!selfClosing) stack.push(tag);
        }

        if (!encontrouRaiz) throw new Error('não é um XML de currículo Lattes (falta CURRICULO-VITAE)');
        p.areas = [...areas];
        p.palavrasChave = [...pcs];
        if (!p.id) p.id = p.nome || p.origem;
        return p;
    }

    return { decodeBuffer, parse, lerArquivo };
});
