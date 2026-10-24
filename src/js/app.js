/* ==========================================================================
   bancaZen — aplicação (seções Meu TCC, com o trecho Orientação, e
   Composição da banca)
   --------------------------------------------------------------------------
   Os campos ficam em seções diferentes (abas) e são lidos pelo id na hora
   da busca, feita na seção Composição da banca. Erros de preenchimento levam à
   seção que falta (botões data-ir, tratados em layout.js).
   O navegador só envia o formulário: a comparação com os currículos e a
   verificação de vínculos rodam no servidor (api/buscar.php), que devolve
   duas listas (Rede PROFIAP e Programa externo à Rede PROFIAP, pelo PPG) com até 10 docentes sem vínculo
   cada, mais as retiradas por vínculo. Os currículos e o índice processado
   nunca chegam ao navegador.
   ========================================================================== */
(function () {
    const $ = (s) => document.querySelector(s);
    const ENVOLVIDOS = ['discente', 'orientador', 'coorientador'];
    const PAPEIS = {
        discente: { rotulo: 'Discente', obrigatorio: false },
        orientador: { rotulo: 'Orientação', obrigatorio: false },
        coorientador: { rotulo: 'Coorientação', obrigatorio: false },
    };

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    function semAcento(s) {
        return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    }
    function dataBR(iso) {
        return /^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? iso.split('-').reverse().join('/') : '';
    }
    const fmt = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    // Endereço público do currículo: o identificador Lattes tem 16 dígitos.
    function urlLattes(p) {
        return /^\d{16}$/.test(p.id) ? `https://lattes.cnpq.br/${p.id}` : '';
    }
    function nomeComLink(p) {
        const url = urlLattes(p);
        return url ? `<a href="${url}" target="_blank" rel="noopener" class="hover:underline">${esc(p.nome)}</a>` : esc(p.nome);
    }
    // Ficha da pessoa em etiquetas: Universidade, PPG, Situação no programa e
    // Link do Lattes (o nome vem no título). Mesma ficha para as duas listas.
    function ficha(p) {
        const url = urlLattes(p);
        const etq = (rotulo, valor, classe = '') => `<li${classe ? ` class="${classe}"` : ''}><span class="sr-only">${rotulo}: </span>${valor}</li>`;
        const permanente = /^permanente/i.test(p.situacao || '');
        return `<ul class="etiquetas-pessoa">
            ${etq('Universidade', esc(p.universidade) || 'não informada')}
            ${etq('PPG', esc(p.ppg) || 'não informado')}
            ${etq('Situação no programa', esc(p.situacao) || 'situação não informada', permanente ? 'ok' : '')}
            ${url ? `<li><a href="${url}" target="_blank" rel="noopener" title="${url}" class="text-brand-600 dark:text-accent-400 hover:underline whitespace-nowrap">Lattes <i aria-hidden="true" class="fa-solid fa-arrow-up-right-from-square text-xs"></i><span class="sr-only"> de ${esc(p.nome)} (abre em nova aba)</span></a></li>` : ''}
        </ul>`;
    }

    /* ------------------------------- status ------------------------------- */
    async function carregarStatus() {
        const st = $('#corpusStatus');
        try {
            const r = await fetch('api/status.php', { cache: 'no-store' });
            if (!r.ok) throw new Error(r.status);
            const n = (await r.json()).curriculos || 0;
            st.textContent = n
                ? `${n} ${n === 1 ? 'currículo cadastrado' : 'currículos cadastrados'} para a comparação.`
                : 'Nenhum currículo cadastrado ainda. Procure a administração do programa.';
            $('#buscarBtn').disabled = !n;
        } catch (_) {
            st.textContent = 'Não foi possível consultar a base de currículos. Tente de novo mais tarde.';
            $('#buscarBtn').disabled = true;
        }
    }

    /* -------------------------------- busca ------------------------------- */
    // Erro na seção Composição da banca, com botão para a seção a corrigir.
    function mostrarErro(msg, secao, rotuloSecao) {
        const erro = $('#buscaErro');
        erro.innerHTML = msg ? esc(msg) + (secao
            ? ` <button type="button" data-ir="${secao}" class="underline font-medium">Ir para ${esc(rotuloSecao)}</button>`
            : '') : '';
        erro.classList.toggle('hidden', !msg);
    }

    /* --------------------------- conferência ------------------------------ */
    // O que já foi informado nas seções 2 e 3, mostrado antes da busca.
    // Nome de cada envolvida: o da discente é "Meu nome".
    const nomeEnvolvido = (k) => $(k === 'discente' ? '#nomeInput' : `#${k}Nome`).value.trim();
    function situacaoEnvolvido(k) {
        const arq = $(`#${k}Arquivo`).files[0];
        if (arq) return { ok: true, texto: `arquivo ${arq.name}` };
        const id = ($(`#${k}Id`).value.match(/\d{16}/) || [])[0];
        if (id) return { ok: true, texto: `Lattes ${id}` };
        const nome = nomeEnvolvido(k);
        if (nome) return { ok: true, texto: `só o nome, ${nome} (verificação parcial)` };
        return { ok: false, texto: PAPEIS[k].obrigatorio ? 'falta informar' : 'não informado (opcional)' };
    }
    function dissertacaoPreenchida() {
        return ['#tituloInput', '#resumoInput', '#palavrasInput'].filter((id) => $(id).value.trim()).length;
    }
    // Nome e universidade da pessoa discente ficam só no navegador.
    function discente() {
        return { nome: $('#nomeInput').value.trim(), universidade: valorUniversidade() };
    }
    // A universidade da pessoa discente preenche o critério "Desconsiderar
    // pessoas desta instituição", sem sobrescrever o que ela digitou lá.
    let excluirAutomatico = '';
    function sincronizarExcluir() {
        const campo = $('#excluirInput');
        const univ = valorUniversidade();
        if (campo.value.trim() === '' || campo.value === excluirAutomatico) {
            campo.value = univ;
            excluirAutomatico = univ;
        }
    }

    function renderConferencia() {
        const n = dissertacaoPreenchida();
        const eu = discente();
        const item = (ok, opcional, rotulo, texto, secao) => `<li class="conferencia-item">
            <span class="marca ${ok ? 'marca-ok' : (opcional ? 'marca-opcional' : 'marca-falta')}" aria-hidden="true">${ok ? '<i class="fa-solid fa-check"></i>' : (opcional ? '' : '<i class="fa-solid fa-xmark"></i>')}</span>
            <span class="flex-1 min-w-0"><span class="font-bold">${esc(rotulo)}:</span> ${esc(texto)}</span>
            <button type="button" data-ir="${secao}" class="text-brand-600 dark:text-accent-400 hover:underline font-bold">${ok ? 'editar' : 'preencher'}</button>
        </li>`;
        $('#conferencia').innerHTML =
            item(Boolean(eu.nome && eu.universidade), true, 'Meus dados',
                [eu.nome, eu.universidade].filter(Boolean).join(' · ') || 'nome e Instituição Associada não informados', 'dissertacao') +
            item(n > 0, false, 'Meu TCC', n === 3 ? 'título, resumo e palavras-chave' : (n ? `${n} de 3 campos preenchidos` : 'falta preencher'), 'dissertacao') +
            ENVOLVIDOS.map((k) => {
                const s = situacaoEnvolvido(k);
                return item(s.ok, !PAPEIS[k].obrigatorio, PAPEIS[k].rotulo, s.texto, 'orientacao');
            }).join('');
    }

    // Resposta que não é JSON (ex.: página de erro da hospedagem): mostra o
    // início do texto, em vez de só o código HTTP.
    async function lerResposta(r) {
        const texto = await r.text();
        try {
            return JSON.parse(texto);
        } catch (_) {
            const trecho = texto.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
            return { erro: `Resposta inesperada do servidor (HTTP ${r.status})${trecho ? `: ${trecho}` : '.'}` };
        }
    }

    async function buscar(ev) {
        ev.preventDefault();
        incluirDigitado();
        mostrarErro('');
        if (!dissertacaoPreenchida()) {
            mostrarErro('Preencha ao menos o título, o resumo ou as palavras-chave.', 'dissertacao', 'Meu TCC');
            return;
        }
        const fd = new FormData();
        fd.append('titulo', $('#tituloInput').value);
        fd.append('resumo', $('#resumoInput').value);
        fd.append('palavrasChave', $('#palavrasInput').value);
        fd.append('excluirInstituicao', $('#excluirInput').value);
        fd.append('somenteDoutores', $('#doutoresInput').checked ? '1' : '0');
        fd.append('somentePermanentes', $('#permanentesInput').checked ? '1' : '0');
        fd.append('periodo', $('#periodoInput').value);
        for (const k of ENVOLVIDOS) {
            const arq = $(`#${k}Arquivo`).files[0];
            if (arq) fd.append(`${k}Arquivo`, arq);
            fd.append(`${k}Id`, $(`#${k}Id`).value);
            fd.append(`${k}Nome`, nomeEnvolvido(k));
        }

        const btn = $('#buscarBtn');
        btn.disabled = true;
        btn.setAttribute('aria-busy', 'true');
        try {
            const r = await fetch('api/buscar.php', { method: 'POST', body: fd });
            const dados = await lerResposta(r);
            if (!r.ok || dados.erro) {
                const msg = dados.erro || `Erro ${r.status} no servidor.`;
                // Erros sobre os currículos da orientação levam à seção 3.
                const daOrientacao = /Discente|Orientador|Coorientador|currículo Lattes/.test(msg);
                mostrarErro(msg, daOrientacao ? 'orientacao' : null, 'Orientação');
                return;
            }
            for (const k of ENVOLVIDOS) {
                const e = dados.envolvidos && dados.envolvidos[k];
                $(`#${k}Status`).textContent = !e ? '' : (e.soNome ? `Considerado só pelo nome: ${e.nome}.` : `Currículo considerado: ${e}.`);
            }
            renderListas(dados.listas || []);
            renderConformidade(dados.conformidade, dados.listas || []);
            // Resultado para a seção Relatório (js/relatorio.js).
            document.dispatchEvent(new CustomEvent('busca:resultado', { detail: {
                listas: dados.listas || [],
                conformidade: dados.conformidade || { verificada: false, considerados: [] },
                criterios: {
                    excluirInstituicao: $('#excluirInput').value.trim(),
                    somenteDoutores: $('#doutoresInput').checked,
                    somentePermanentes: $('#permanentesInput').checked,
                    periodo: Number($('#periodoInput').value) || 0,
                },
                dissertacao: dadosDissertacao(),
                em: new Date(),
            } }));
        } catch (_) {
            mostrarErro('Não foi possível falar com o servidor. Verifique a conexão e tente de novo.');
        } finally {
            btn.disabled = false;
            btn.removeAttribute('aria-busy');
        }
    }

    function descreverVinculo(v) {
        const det = v.detalhes || [];
        if (v.tipo === 'mesma pessoa') return `${v.papel}: é o currículo da própria pessoa.`;
        if (v.tipo === 'coautoria') {
            const anos = det.map((d) => parseInt(d.a, 10)).filter(Boolean);
            const titulos = det.slice(0, 3).map((d) => `“${d.t}”${d.a ? ` (${d.a})` : ''}`).join('; ');
            return `${v.papel}: coautoria em ${det.length} ${det.length === 1 ? 'publicação' : 'publicações'}` +
                (anos.length ? `, a mais recente em ${Math.max(...anos)}` : '') +
                `. ${titulos}${det.length > 3 ? '; …' : ''}`;
        }
        return `${v.papel}: ${det.map((d) => d.t + (d.a ? ` (${d.a})` : '')).join('; ')}.`;
    }

    function itemResultado(r, i) {
        const p = r.pessoa;
        const pct = Math.round(r.score * 100);
        const detalhes = [
            p.titulacao,
            p.instituicao && p.instituicao !== p.universidade ? `vínculo atual no Lattes: ${[p.instituicao, p.uf].filter(Boolean).join(' / ')}` : '',
            `${p.bancasMestrado} banca(s) de mestrado no Lattes`,
            p.atualizacao ? `currículo atualizado em ${dataBR(p.atualizacao)}` : '',
        ].filter(Boolean);
        return `<li class="indicacao">
            <div class="indicacao-topo">
                <span class="posicao" aria-hidden="true">${i + 1}º</span>
                <h4 class="indicacao-nome"><span class="sr-only">${i + 1}º: </span>${nomeComLink(p)}</h4>
                <span class="indicacao-indice" aria-label="Proximidade ${fmt.format(r.score)} numa escala de 0 a 1">${fmt.format(r.score)}</span>
            </div>
            <div class="score-bar" aria-hidden="true"><span style="width:${pct}%"></span></div>
            ${ficha(p)}
            ${r.termos.length ? `<p class="indicacao-termos">Termos em comum: <strong>${esc(r.termos.join(', '))}</strong></p>` : ''}
            <p class="indicacao-detalhes">${esc(detalhes.join(' · '))}</p>
        </li>`;
    }

    function blocoRetirados(retirados) {
        if (!retirados.length) return '';
        const itens = retirados.map((r) => {
            const vs = r.vinculos.map((v) => `<li>
                <span class="badge ${v.certeza === 'confirmado' ? 'vinculo-confirmado' : 'vinculo-provavel'}">${v.certeza === 'confirmado' ? 'confirmado' : 'provável'}</span>
                ${esc(descreverVinculo(v))}</li>`).join('');
            return `<li class="space-y-2">
                <p class="font-bold m-0">${nomeComLink(r.pessoa)} <span class="font-normal text-sm">(${fmt.format(r.score)})</span></p>
                ${ficha(r.pessoa)}
                <ul class="text-sm space-y-1 m-0 p-0 list-none">${vs}</ul>
            </li>`;
        }).join('');
        const n = retirados.length;
        return `<details class="retiradas">
            <summary><i aria-hidden="true" class="fa-solid fa-scale-balanced"></i> ${n} ${n === 1 ? 'retirada' : 'retiradas'} por vínculo (conflito de interesses, item 13.3)</summary>
            <p class="text-sm mt-3">
                Estas indicações teriam proximidade suficiente para a lista, mas têm vínculo com você ou com a
                orientação. Vínculo "provável" foi identificado só pelo nome em citação e pode ser homonímia:
                confira no Lattes antes de descartar.
            </p>
            <ul class="space-y-4 m-0 p-0 list-none">${itens}</ul>
        </details>`;
    }

    // Quadro "Conformidade ética" do resultado: quem foi considerado (Minha
    // orientação é opcional) ou o aviso de que os vínculos não foram verificados.
    function renderConformidade(c, listas) {
        const caixa = $('#conformidadeResultado');
        const considerados = (c && c.considerados) || [];
        if (!considerados.length) {
            caixa.innerHTML = `<div class="aviso aviso-alerta">
                <i aria-hidden="true" class="fa-solid fa-triangle-exclamation"></i>
                <div class="space-y-2">
                <h4 class="font-bold m-0">Vínculos não verificados</h4>
                <p class="text-sm">"Orientação" não foi preenchida: as listas podem incluir docentes com coautoria ou relação de
                orientação com você ou com a orientação (item 13.3). Para fazer essa verificação, informe os currículos e busque de novo.</p>
                <button type="button" data-ir="orientacao" class="botao-secundario">Preencher Orientação</button>
                </div>
            </div>`;
            return;
        }
        const retirados = listas.reduce((n, l) => n + (l.retirados || []).length, 0);
        const pessoas = considerados.map((p) => `<li><span class="font-medium">${esc(p.papel)}:</span> ${p.id
            ? `<a href="https://lattes.cnpq.br/${esc(p.id)}" target="_blank" rel="noopener" class="text-brand-600 dark:text-accent-400 hover:underline">${esc(p.nome)}</a>`
            : esc(p.nome)}${p.soNome ? ' <span class="text-gray-600 dark:text-gray-400">(só pelo nome: sem o currículo, as produções desta pessoa não foram conferidas)</span>' : ''}</li>`).join('');
        caixa.innerHTML = `<div class="aviso aviso-ok">
            <i aria-hidden="true" class="fa-solid fa-shield-halved"></i>
            <div class="space-y-1">
            <h4 class="font-bold m-0">Vínculos verificados</h4>
            <p class="text-sm">Vínculos (coautoria, orientação ou mesma pessoa) conferidos com os currículos de:</p>
            <ul class="text-sm list-disc list-inside">${pessoas}</ul>
            <p class="text-sm">${retirados
                ? `${retirados} ${retirados === 1 ? 'indicação com vínculo retirada' : 'indicações com vínculo retiradas'} das listas; aparecem à parte, com o motivo, ao fim de cada lista.`
                : 'Nenhum vínculo entre os currículos com maior proximidade temática.'}</p>
            </div>
        </div>`;
    }

    function renderListas(listas) {
        const sec = $('#resultado');
        sec.classList.remove('hidden');
        const eu = discente();
        $('#resultadoTitulo').textContent = eu.nome || eu.universidade
            ? `Docentes com maior proximidade temática: indicações para ${[eu.nome, eu.universidade].filter(Boolean).join(' · ')}`
            : 'Docentes com maior proximidade temática';
        $('#listas').innerHTML = listas.map((l) => {
            const resumo = (l.resultados.length
                ? `${l.resultados.length} ${l.resultados.length === 1 ? 'indicação' : 'indicações'} entre ${l.total} currículo(s) desta lista.`
                : (l.total
                    ? `Nenhum dos ${l.total} currículo(s) desta lista tem termos em comum com o trabalho sem ter vínculo identificado.`
                    : 'Nenhum currículo cadastrado nesta lista.'))
                + (l.foraSituacao ? ` ${l.foraSituacao} currículo(s) fora da busca por não constar como docente permanente.` : '');
            const alinea = l.grupo === 'profiap' ? '13.1 b' : '13.1 c';
            return `<section class="space-y-3" aria-labelledby="lista-${l.grupo}">
                <div class="flex items-center gap-2">
                    <h3 id="lista-${l.grupo}" class="cartao-titulo flex-1">${esc(l.titulo)}</h3>
                    <span class="selo${l.grupo === 'profiap' ? '' : ' verde'}">${alinea}</span>
                </div>
                <p class="ajuda m-0">${esc(resumo)}</p>
                <ol class="lista-resultado list-none p-0 m-0 space-y-3">${l.resultados.map(itemResultado).join('')}</ol>
                ${blocoRetirados(l.retirados)}
            </section>`;
        }).join('');
        sec.focus();
    }

    // Dados de Meu TCC usados no Relatório.
    function dadosDissertacao() {
        return {
            nome: $('#nomeInput').value.trim(),
            universidade: valorUniversidade(),
            titulo: $('#tituloInput').value.trim(),
            orientador: $('#orientadorNome').value.trim(),
            coorientador: $('#coorientadorNome').value.trim(),
        };
    }
    window.BancaZen = { dadosDissertacao };

    /* -------------------- Minha Instituição Associada ---------------------- */
    // Caixa de seleção com as universidades da base (api/universidades.php) e
    // "Outra (digitar)", que mostra um campo de texto.
    const OUTRA = '__outra__';
    let universidadePendente = null; // valor importado antes de a lista chegar
    function valorUniversidade() {
        const sel = $('#universidadeInput');
        return sel.value === OUTRA ? $('#universidadeOutraInput').value.trim() : sel.value.trim();
    }
    function mostrarOutra() {
        $('#universidadeOutraInput').hidden = $('#universidadeInput').value !== OUTRA;
    }
    function definirUniversidade(v) {
        const sel = $('#universidadeInput');
        v = String(v || '').trim();
        const opcao = [...sel.options].find((o) => o.value !== OUTRA && semAcento(o.value) === semAcento(v));
        if (!v) sel.value = '';
        else if (opcao) sel.value = opcao.value;
        else {
            sel.value = OUTRA;
            $('#universidadeOutraInput').value = v;
            if (sel.options.length <= 2) universidadePendente = v; // a lista ainda não chegou
        }
        mostrarOutra();
        sincronizarExcluir();
    }
    async function carregarUniversidades() {
        try {
            const r = await fetch('api/universidades.php');
            const lista = r.ok ? ((await r.json()).universidades || []) : [];
            const sel = $('#universidadeInput');
            const atual = valorUniversidade();
            const outra = sel.querySelector(`option[value="${OUTRA}"]`);
            for (const u of lista) {
                const o = document.createElement('option');
                o.value = u;
                o.textContent = u;
                sel.insertBefore(o, outra);
            }
            const pendente = universidadePendente;
            universidadePendente = null;
            if (pendente || atual) definirUniversidade(pendente || atual);
        } catch (_) {
            // Sem a lista, "Outra (digitar)" continua disponível.
        }
    }

    /* ------------------- exportar/importar (arquivo JSON) ------------------ */
    // Os dados de Meu TCC (com Orientação e os critérios da
    // busca) num arquivo JSON, só no computador da pessoa: nada vai ao
    // servidor. Os arquivos XML/ZIP do Lattes não entram (só links/IDs).
    const CAMPOS_JSON = {
        dissertacao: { nome: '#nomeInput', titulo: '#tituloInput', resumo: '#resumoInput', palavrasChave: '#palavrasInput' },
        orientacao: {
            discente: '#discenteId', orientadorNome: '#orientadorNome', orientador: '#orientadorId',
            coorientadorNome: '#coorientadorNome', coorientador: '#coorientadorId', periodo: '#periodoInput',
        },
        criterios: { excluirInstituicao: '#excluirInput', somenteDoutores: '#doutoresInput', somentePermanentes: '#permanentesInput' },
    };
    function exportarJson() {
        const dados = { app: 'bancaZen', formato: 1, exportadoEm: new Date().toISOString() };
        for (const [grupo, campos] of Object.entries(CAMPOS_JSON)) {
            dados[grupo] = {};
            for (const [chave, sel] of Object.entries(campos)) {
                const el = $(sel);
                dados[grupo][chave] = el.type === 'checkbox' ? el.checked : el.value;
            }
        }
        dados.dissertacao.universidade = valorUniversidade();
        const nome = semAcento(dados.dissertacao.nome).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'dissertacao';
        const url = URL.createObjectURL(new Blob([JSON.stringify(dados, null, 2)], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = `bancazen-${nome}-${dados.exportadoEm.slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        const arquivos = ENVOLVIDOS.filter((k) => $(`#${k}Arquivo`).files[0]).length;
        $('#jsonStatus').textContent = `Dados exportados para ${a.download}.` +
            (arquivos ? ' Os arquivos XML/ZIP do Lattes não vão no JSON: ao importar, envie-os de novo ou informe o link do Lattes.' : '');
    }
    async function importarJson(arquivo) {
        const status = $('#jsonStatus');
        try {
            const dados = JSON.parse(await arquivo.text());
            if (!dados || typeof dados !== 'object' || (dados.app && dados.app !== 'bancaZen') || !dados.dissertacao) {
                throw new Error('o arquivo não é uma exportação do bancaZen');
            }
            for (const [grupo, campos] of Object.entries(CAMPOS_JSON)) {
                for (const [chave, sel] of Object.entries(campos)) {
                    const v = dados[grupo] && dados[grupo][chave];
                    if (v === undefined || v === null) continue;
                    const el = $(sel);
                    if (el.type === 'checkbox') el.checked = Boolean(v);
                    else el.value = String(v);
                    // Avisa os ouvintes (ex.: universidade -> critério de instituição).
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }
            if (typeof dados.dissertacao.universidade === 'string') definirUniversidade(dados.dissertacao.universidade);
            renderConferencia();
            atualizarEtapas();
            status.textContent = `Dados importados de ${arquivo.name}.`;
        } catch (e) {
            status.textContent = `Não foi possível importar ${arquivo.name}: ${e.message}.`;
        }
    }

    /* ------------- Meu TCC: etiquetas, arquivos e etapas -------------- */
    // Palavras-chave em etiquetas: o texto fica em #palavrasInput (oculto,
    // separado por "; "), lido pela busca, pela conferência e pelo JSON.
    const separarPalavras = (t) => String(t || '').split(/[;,\n]+/).map((x) => x.trim()).filter(Boolean);
    const palavras = () => separarPalavras($('#palavrasInput').value);
    function renderPalavras() {
        $('#palavrasLista').innerHTML = palavras().map((x, i) => `<li class="etiqueta">${esc(x)}<button type="button" data-remover="${i}" aria-label="Remover ${esc(x)}"><i aria-hidden="true" class="fa-solid fa-xmark"></i></button></li>`).join('');
    }
    function gravarPalavras(lista, aviso) {
        const vistas = new Set();
        $('#palavrasInput').value = lista.filter((x) => !vistas.has(semAcento(x)) && vistas.add(semAcento(x))).join('; ');
        renderPalavras();
        $('#palavrasAviso').textContent = aviso;
        atualizarEtapas();
    }
    function incluirDigitado() {
        const campo = $('#palavraNovaInput');
        const novas = separarPalavras(campo.value);
        campo.value = '';
        if (novas.length) gravarPalavras([...palavras(), ...novas], `Incluída: ${novas.join(', ')}.`);
    }
    function iniciarPalavras() {
        const campo = $('#palavraNovaInput');
        campo.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                incluirDigitado();
            } else if (e.key === 'Backspace' && !campo.value && palavras().length) {
                const lista = palavras();
                const x = lista.pop();
                gravarPalavras(lista, `Removida: ${x}.`);
            }
        });
        campo.addEventListener('input', () => { if (/[;,]/.test(campo.value)) incluirDigitado(); });
        campo.addEventListener('blur', incluirDigitado);
        $('#palavrasLista').addEventListener('click', (e) => {
            const b = e.target.closest('[data-remover]');
            if (!b) return;
            const lista = palavras();
            const [x] = lista.splice(Number(b.dataset.remover), 1);
            gravarPalavras(lista, `Removida: ${x}.`);
            campo.focus();
        });
        // A importação do JSON grava o texto direto no campo oculto.
        $('#palavrasInput').addEventListener('input', renderPalavras);
        renderPalavras();
    }

    // Áreas de arrastar e soltar o XML/ZIP do Lattes (o <input type="file">
    // fica dentro do rótulo): mostram o nome do arquivo escolhido.
    function iniciarSoltar() {
        document.querySelectorAll('.soltar').forEach((zona) => {
            const input = zona.querySelector('input[type="file"]');
            const nome = zona.querySelector('.soltar-nome');
            const padrao = nome.textContent;
            input.addEventListener('change', () => {
                const f = input.files[0];
                nome.textContent = f ? f.name : padrao;
                zona.classList.toggle('com-arquivo', Boolean(f));
            });
            zona.addEventListener('dragover', (e) => { e.preventDefault(); zona.classList.add('arrastando'); });
            zona.addEventListener('dragleave', () => zona.classList.remove('arrastando'));
            zona.addEventListener('drop', (e) => {
                e.preventDefault();
                zona.classList.remove('arrastando');
                if (e.dataTransfer && e.dataTransfer.files.length) {
                    input.files = e.dataTransfer.files;
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                }
            });
        });
    }

    // Indicador de etapas de Meu TCC (Sobre você, O TCC, Orientação),
    // contagem de campos do TCC e de palavras do resumo.
    function atualizarEtapas() {
        const eu = discente();
        const n = dissertacaoPreenchida();
        const feitas = [Boolean(eu.nome && eu.universidade), n === 3, ['orientador', 'coorientador'].some((k) => situacaoEnvolvido(k).ok)];
        const atual = feitas.indexOf(false);
        document.querySelectorAll('#etapasTcc .etapa').forEach((li, i) => {
            const estado = feitas[i] ? 'feito' : (i === atual ? 'atual' : 'pendente');
            li.dataset.estado = estado;
            li.querySelector('button').setAttribute('aria-current', estado === 'atual' ? 'step' : 'false');
            li.querySelector('.etapa-estado').textContent = estado === 'feito' ? ' (preenchida)' : '';
        });
        $('#tccContagem').textContent = `${n} de 3 campos`;
        const np = $('#resumoInput').value.trim().split(/\s+/).filter(Boolean).length;
        $('#resumoContagem').textContent = `${np} ${np === 1 ? 'palavra' : 'palavras'}`;
    }
    function iniciarEtapas() {
        const painel = $('#tab-dissertacao');
        painel.addEventListener('input', atualizarEtapas);
        painel.addEventListener('change', atualizarEtapas);
        document.querySelectorAll('#etapasTcc .etapa button').forEach((b) => b.addEventListener('click', () => {
            const alvo = document.getElementById(b.parentElement.dataset.alvo);
            const suave = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            alvo.scrollIntoView({ behavior: suave ? 'smooth' : 'auto', block: 'start' });
            alvo.focus({ preventScroll: true });
        }));
        atualizarEtapas();
    }

    /* -------------------------------- início ------------------------------ */
    function init() {
        $('#buscaForm').addEventListener('submit', buscar);
        for (const k of ENVOLVIDOS) {
            $(`#${k}Arquivo`).addEventListener('change', (e) => {
                const f = e.target.files[0];
                $(`#${k}Status`).textContent = f ? `Arquivo selecionado: ${f.name}.` : '';
            });
        }
        document.addEventListener('tab:change', (e) => {
            const tab = e.detail && e.detail.tab;
            if (tab === 'bancas') renderConferencia();
            // A base pode ter mudado (ex.: envio pela Administração nesta página).
            if (tab === 'bancas' || tab === 'inicio') carregarStatus();
        });
        $('#universidadeInput').addEventListener('change', () => {
            mostrarOutra();
            if ($('#universidadeInput').value === OUTRA) $('#universidadeOutraInput').focus();
            sincronizarExcluir();
        });
        $('#universidadeOutraInput').addEventListener('input', sincronizarExcluir);
        carregarUniversidades();
        $('#exportarJsonBtn').addEventListener('click', exportarJson);
        $('#importarJsonBtn').addEventListener('click', () => $('#importarJsonInput').click());
        $('#importarJsonInput').addEventListener('change', (e) => {
            if (e.target.files[0]) importarJson(e.target.files[0]);
            e.target.value = '';
        });
        iniciarPalavras();
        iniciarSoltar();
        iniciarEtapas();
        renderConferencia();
        carregarStatus();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
