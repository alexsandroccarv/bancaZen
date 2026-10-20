/* ==========================================================================
   BuscaBanca — Proximidade temática (TF-IDF + cosseno)
   --------------------------------------------------------------------------
   Cada currículo vira um vetor de termos ponderados; o trabalho informado
   (título, resumo, palavras-chave) vira outro. A proximidade é o cosseno
   entre os dois vetores: como todos os pesos são positivos, o valor fica
   sempre entre 0 (nenhum termo em comum) e 1 (mesmo perfil de termos).

   Etapas do texto: minúsculas, remoção de acentos, palavras vazias
   (português e inglês), radical leve (plural e vogal temática) e bigramas
   (ex.: "administracao publica"), que distinguem expressões compostas.

   Pesos por campo do currículo (o que a pessoa declara como foco pesa mais
   do que o que aparece de passagem): ver PESOS_CURRICULO. Produções antigas
   pesam menos (ver pesoRecencia). Na consulta, palavras-chave e título
   pesam mais que o resumo (ver PESOS_CONSULTA).

   Usado no navegador (window.Similaridade) e no Node (testes).
   ========================================================================== */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.Similaridade = factory();
})(typeof self !== 'undefined' ? self : this, function () {

    const PESOS_CURRICULO = {
        palavrasChave: 3, linhas: 2.5, areas: 2, formacao: 2,
        producoes: 1.5, projetos: 1.5, orientacoes: 1, resumo: 1,
    };
    const PESOS_CONSULTA = { palavrasChave: 3, titulo: 2, resumo: 1 };
    const PESO_BIGRAMA = 1.5;

    // Produções dos últimos 10 anos valem integralmente; antes disso o peso
    // cai até 0,4, para privilegiar a atuação recente sem descartar a antiga.
    function pesoRecencia(ano, anoAtual) {
        const a = parseInt(ano, 10);
        if (!a) return 0.8;
        const idade = anoAtual - a;
        if (idade <= 10) return 1;
        return Math.max(0.4, 1 - (idade - 10) * 0.04);
    }

    /* ---------------------------- normalização ---------------------------- */
    const STOP = new Set((
        // português
        'a ao aos as ate com como da das de dei do dos e ela elas ele eles em entre era essa esse esta este eu foi ' +
        'for ha isso isto ja la mais mas me mesmo meu minha muito na nas nao nem no nos nossa nosso num numa o os ou ' +
        'para pela pelas pelo pelos por qual quando que quem se sem ser seu seus sua suas so sob sobre tambem te tem ' +
        'ter seja sao foram sendo seus tal tais uma umas um uns vez cada outro outra outros outras onde apos ' +
        'atraves partir assim ainda bem ate desde durante pois porque todo toda todos todas este esta estes estas ' +
        'aquele aquela isso deste desta destes destas neste nesta nesse nessa dessa desse cujo cuja ' +
        // inglês
        'the of and in on for to with by from an at is are was were be this that these those its as or not ' +
        'into their which using use based ' +
        // genéricas de textos acadêmicos (aparecem em quase todo título)
        'estudo estudos analise analises caso casos uso partir sobre trabalho pesquisa pesquisas proposta ' +
        'dissertacao tese artigo objetivo objetivos resultado resultados forma meio meios contexto ' +
        'study analysis case approach paper research'
    ).split(/\s+/));

    function semAcento(s) {
        return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    }
    // Radical leve: plurais e vogal temática final. Não é um stemmer completo
    // (como o RSLP), mas aproxima "politicas publicas" de "politica publica"
    // e "gestoes" de "gestao" sem fundir palavras de sentidos distintos.
    function radical(w) {
        if (w.length <= 3) return w;
        if (w.endsWith('coes')) w = w.slice(0, -4) + 'cao';
        else if (w.endsWith('oes') || w.endsWith('aes')) w = w.slice(0, -3) + 'ao';
        else if (w.endsWith('ais')) w = w.slice(0, -3) + 'al';
        else if (w.endsWith('eis') && w.length > 5) w = w.slice(0, -3) + 'el';
        else if (w.endsWith('ns')) w = w.slice(0, -2) + 'm';
        else if (w.endsWith('res') || w.endsWith('zes')) w = w.slice(0, -2);
        else if (w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us') && !w.endsWith('is')) w = w.slice(0, -1);
        if (w.length > 4 && /[aoe]$/.test(w)) w = w.slice(0, -1);
        return w;
    }

    // Texto -> lista de { r: radical, f: palavra original (para exibir),
    // p: posição da palavra no texto, contando as palavras vazias }.
    function tokens(texto) {
        const out = [];
        const re = /[\p{L}\p{N}]+/gu;
        const base = String(texto || '');
        let m, pos = -1;
        while ((m = re.exec(base))) {
            pos++;
            const forma = m[0];
            const w = semAcento(forma);
            if (w.length < 3 || STOP.has(w) || /^\d+$/.test(w)) continue;
            out.push({ r: radical(w), f: forma.toLowerCase(), p: pos });
        }
        return out;
    }

    // Soma ao mapa `tf` os termos (e bigramas) de `texto`, com o peso dado.
    function acumular(tf, texto, peso, formas) {
        const tk = tokens(texto);
        for (let i = 0; i < tk.length; i++) {
            tf.set(tk[i].r, (tf.get(tk[i].r) || 0) + peso);
            if (formas && !formas.has(tk[i].r)) formas.set(tk[i].r, tk[i].f);
            if (i > 0) {
                const bg = tk[i - 1].r + ' ' + tk[i].r;
                tf.set(bg, (tf.get(bg) || 0) + peso * PESO_BIGRAMA);
                // Só exibe o bigrama quando as palavras são vizinhas no texto
                // ("transparência ativa"), e não separadas por palavras vazias.
                if (formas && !formas.get(bg) && tk[i].p === tk[i - 1].p + 1) formas.set(bg, tk[i - 1].f + ' ' + tk[i].f);
            }
        }
    }

    function tfCurriculo(p, anoAtual) {
        const tf = new Map();
        const w = PESOS_CURRICULO;
        acumular(tf, p.resumo, w.resumo);
        for (const t of p.palavrasChave || []) acumular(tf, t, w.palavrasChave);
        for (const t of p.areas || []) acumular(tf, t, w.areas);
        for (const t of p.linhas || []) acumular(tf, t, w.linhas);
        for (const campo of ['formacao', 'producoes', 'projetos', 'orientacoes']) {
            for (const it of p[campo] || []) acumular(tf, it.t, w[campo] * pesoRecencia(it.a, anoAtual));
        }
        return tf;
    }

    // Frequência sublinear: evita que um currículo muito extenso domine só
    // por repetir o mesmo termo centenas de vezes.
    function vetor(tf, idf) {
        const v = new Map();
        let norma = 0;
        for (const [t, f] of tf) {
            const peso = (1 + Math.log(f)) * (idf.get(t) || 0);
            if (peso > 0) { v.set(t, peso); norma += peso * peso; }
        }
        return { v, norma: Math.sqrt(norma) };
    }

    /* ------------------------------- índice ------------------------------- */
    function criarIndice(pessoas, anoAtual) {
        anoAtual = anoAtual || new Date().getFullYear();
        const tfs = pessoas.map(p => tfCurriculo(p, anoAtual));
        const df = new Map();
        for (const tf of tfs) for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
        const N = pessoas.length;
        // IDF suavizado: termo presente em todos os currículos ainda vale um pouco.
        const idf = new Map();
        for (const [t, n] of df) idf.set(t, Math.log((N + 1) / (n + 1)) + 1);
        const docs = tfs.map((tf, i) => ({ pessoa: pessoas[i], ...vetor(tf, idf) }));
        return { docs, idf, N };
    }

    /* ------------------------------- busca -------------------------------- */
    // consulta = { titulo, resumo, palavrasChave: string[] }
    // opcoes   = { limite, excluirInstituicao, somenteDoutores }
    function buscar(indice, consulta, opcoes) {
        opcoes = opcoes || {};
        const limite = opcoes.limite || 10;
        const tf = new Map();
        const formas = new Map();
        for (const k of consulta.palavrasChave || []) acumular(tf, k, PESOS_CONSULTA.palavrasChave, formas);
        acumular(tf, consulta.titulo, PESOS_CONSULTA.titulo, formas);
        acumular(tf, consulta.resumo, PESOS_CONSULTA.resumo, formas);
        const q = vetor(tf, indice.idf);
        if (!q.norma) return { resultados: [], termosConsulta: 0, avaliados: 0 };

        const excluir = semAcento(opcoes.excluirInstituicao || '').trim();
        const candidatos = indice.docs.filter(d => {
            if (opcoes.somenteDoutores && (d.pessoa.nivel || 0) < 5) return false; // 5 = Doutorado
            if (excluir && semAcento(d.pessoa.instituicao).includes(excluir)) return false;
            return true;
        });

        const resultados = candidatos.map(d => {
            let prod = 0;
            const contrib = [];
            for (const [t, qw] of q.v) {
                const dw = d.v.get(t);
                if (dw) { prod += qw * dw; contrib.push([t, qw * dw]); }
            }
            const score = d.norma ? Math.min(1, prod / (q.norma * d.norma)) : 0;
            contrib.sort((a, b) => b[1] - a[1]);
            // Termos em comum que mais pesaram (sem repetir a palavra de um bigrama já listado).
            const termos = [];
            for (const [t] of contrib) {
                const f = formas.get(t);
                if (!f || termos.some(x => x.includes(f) || f.includes(x))) continue;
                termos.push(f);
                if (termos.length >= 6) break;
            }
            return { pessoa: d.pessoa, score, termos };
        }).filter(r => r.score > 0);

        resultados.sort((a, b) => b.score - a.score || a.pessoa.nome.localeCompare(b.pessoa.nome, 'pt-BR'));
        return { resultados: resultados.slice(0, limite), termosConsulta: q.v.size, avaliados: candidatos.length };
    }

    return { criarIndice, buscar, tokens, radical, pesoRecencia };
});
