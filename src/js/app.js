/* ==========================================================================
   BuscaBanca — aplicação (abas "Indicar banca" e "Currículos")
   --------------------------------------------------------------------------
   1. Carrega data/corpus.json (gerado pelo build a partir da pasta lattes/).
   2. Permite acrescentar XML/ZIP do computador (lidos só no navegador).
   3. Recebe título, resumo e palavras-chave e exibe as 10 pessoas com maior
      proximidade temática (0 a 1), em ordem decrescente.
   4. Conformidade ética: recebe o Lattes da pessoa discente e da orientação
      e retira da lista quem tem vínculo com elas (exibido à parte).
   Depende de: lattes-corpus.js (window.LattesCorpus), similaridade.js
   (window.Similaridade) e vinculos.js (window.Vinculos).
   ========================================================================== */
(function () {
    const LIMITE = 10;
    const $ = (s) => document.querySelector(s);

    let doServidor = [];
    let locais = [];
    let indice = null;
    // Currículos lidos de arquivo para a verificação de vínculos.
    const ENVOLVIDOS = [
        { chave: 'discente', papel: 'Discente', obrigatorio: true },
        { chave: 'orientador', papel: 'Orientador(a)', obrigatorio: true },
        { chave: 'coorientador', papel: 'Coorientador(a)', obrigatorio: false },
    ];
    const lidosDeArquivo = {};

    function todos() {
        // O mesmo currículo em duas fontes: vale a atualização mais recente.
        const porId = new Map();
        for (const p of [...doServidor, ...locais]) {
            const atual = porId.get(p.id);
            if (!atual || (p.atualizacao || '') > (atual.atualizacao || '')) porId.set(p.id, p);
        }
        return [...porId.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    function dataBR(iso) {
        return /^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? iso.split('-').reverse().join('/') : '';
    }
    const fmt = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    // Endereço público do currículo: o identificador Lattes tem 16 dígitos.
    function urlLattes(p) {
        return /^\d{16}$/.test(p.id) ? `https://lattes.cnpq.br/${p.id}` : '';
    }

    /* -------------------------- índice e estado --------------------------- */
    function reindexar() {
        const lista = todos();
        indice = lista.length ? window.Similaridade.criarIndice(lista) : null;
        $('#corpusStatus').textContent = lista.length
            ? `${lista.length} ${lista.length === 1 ? 'currículo disponível' : 'currículos disponíveis'} para a comparação.`
            : 'Nenhum currículo disponível. Adicione arquivos XML do Lattes na aba Currículos.';
        $('#buscarBtn').disabled = !lista.length;
        $('#limparLocaisBtn').classList.toggle('hidden', !locais.length);
        renderTabela(lista);
    }

    function renderTabela(lista) {
        const tbody = $('#curriculosTabela');
        if (!lista.length) {
            tbody.innerHTML = '<tr><td colspan="5" class="py-3 text-gray-500 dark:text-gray-400">Nenhum currículo carregado.</td></tr>';
            return;
        }
        tbody.innerHTML = lista.map((p) => {
            const url = urlLattes(p);
            const nome = url ? `<a href="${url}" target="_blank" rel="noopener" class="text-brand-600 dark:text-accent-400 hover:underline">${esc(p.nome)}</a>` : esc(p.nome);
            const origem = locais.includes(p) ? 'Seu computador' : 'Site';
            return `<tr class="border-b border-gray-200 dark:border-gray-700">
                <td class="py-2 pr-3">${nome}</td>
                <td class="py-2 pr-3">${esc(p.titulacao) || '—'}</td>
                <td class="py-2 pr-3">${esc([p.instituicao, p.uf].filter(Boolean).join(' / ')) || '—'}</td>
                <td class="py-2 pr-3 whitespace-nowrap">${dataBR(p.atualizacao) || '—'}</td>
                <td class="py-2">${origem}</td>
            </tr>`;
        }).join('');
    }

    async function carregarDoServidor() {
        try {
            const r = await fetch('data/corpus.json', { cache: 'no-cache' });
            if (!r.ok) throw new Error(r.status);
            doServidor = (await r.json()).curriculos || [];
        } catch (_) {
            doServidor = []; // sem build (desenvolvimento local) ou pasta lattes/ vazia
        }
        reindexar();
    }

    /* --------------------------- arquivos locais -------------------------- */
    async function adicionarArquivos(files) {
        const alvo = [...files].filter((f) => /\.(xml|zip)$/i.test(f.name));
        const status = $('#cargaStatus');
        if (!alvo.length) { status.textContent = 'Nenhum arquivo .xml ou .zip encontrado.'; return; }
        status.textContent = `Lendo ${alvo.length} arquivo(s)…`;
        const falhas = [];
        let lidos = 0;
        for (const f of alvo) {
            try {
                const novos = await window.LattesCorpus.lerArquivo(f.webkitRelativePath || f.name, await f.arrayBuffer());
                locais.push(...novos);
                lidos += novos.length;
            } catch (e) {
                falhas.push(`${f.name} (${e.message})`);
            }
        }
        status.textContent = `${lidos} currículo(s) adicionado(s).` + (falhas.length ? ` Ignorados: ${falhas.join('; ')}.` : '');
        reindexar();
    }

    /* ------------------------- discente e orientação ---------------------- */
    async function lerEnvolvido(env, file) {
        const status = $(`#${env.chave}Status`);
        delete lidosDeArquivo[env.chave];
        if (!file) { status.textContent = ''; return; }
        try {
            const [p] = await window.LattesCorpus.lerArquivo(file.name, await file.arrayBuffer());
            lidosDeArquivo[env.chave] = p;
            status.textContent = `Currículo lido: ${p.nome}.`;
        } catch (e) {
            status.textContent = `Não foi possível ler ${file.name} (${e.message}).`;
        }
    }

    // Arquivo enviado tem prioridade; senão, procura o link/ID na base.
    function resolverEnvolvidos() {
        const lista = [];
        const faltando = [];
        for (const env of ENVOLVIDOS) {
            let pessoa = lidosDeArquivo[env.chave] || null;
            const texto = $(`#${env.chave}Id`).value.trim();
            if (!pessoa && texto) {
                const id = (texto.match(/\d{16}/) || [])[0];
                pessoa = id ? todos().find((p) => p.id === id) || null : null;
                $(`#${env.chave}Status`).textContent = pessoa
                    ? `Currículo encontrado na base: ${pessoa.nome}.`
                    : 'Currículo não encontrado na base. Envie o arquivo XML ou ZIP do Lattes.';
                if (!pessoa) { faltando.push(env.papel); continue; }
            }
            if (pessoa) lista.push({ papel: env.papel, pessoa });
            else if (env.obrigatorio) faltando.push(env.papel);
        }
        return { lista, faltando };
    }

    /* -------------------------------- busca ------------------------------- */
    function separarPalavras(s) {
        return String(s || '').split(/[;,\n]/).map((x) => x.trim()).filter(Boolean);
    }

    function buscar(ev) {
        ev.preventDefault();
        const erro = $('#buscaErro');
        const consulta = {
            titulo: $('#tituloInput').value.trim(),
            resumo: $('#resumoInput').value.trim(),
            palavrasChave: separarPalavras($('#palavrasInput').value),
        };
        erro.classList.add('hidden');
        if (!consulta.titulo && !consulta.resumo && !consulta.palavrasChave.length) {
            erro.textContent = 'Preencha ao menos o título, o resumo ou as palavras-chave.';
            erro.classList.remove('hidden');
            $('#tituloInput').focus();
            return;
        }
        const envolvidos = resolverEnvolvidos();
        if (envolvidos.faltando.length) {
            erro.textContent = `Informe o currículo Lattes de: ${envolvidos.faltando.join(', ')}.`;
            erro.classList.remove('hidden');
            $(`#${ENVOLVIDOS.find((e) => envolvidos.faltando.includes(e.papel)).chave}Arquivo`).focus();
            return;
        }
        if (!indice) return;
        const { resultados: ranking, avaliados } = window.Similaridade.buscar(indice, consulta, {
            limite: Infinity,
            excluirInstituicao: $('#excluirInput').value,
            somenteDoutores: $('#doutoresInput').checked,
        });
        // Percorre o ranking completo: quem tem vínculo sai da lista (e é
        // exibido à parte) até completar as 10 pessoas sem vínculo.
        const periodo = parseInt($('#periodoInput').value, 10);
        const desdeAno = periodo ? new Date().getFullYear() - periodo + 1 : 0;
        const resultados = [];
        const retirados = [];
        for (const r of ranking) {
            if (resultados.length >= LIMITE) break;
            const vinculos = window.Vinculos.verificar(r.pessoa, envolvidos.lista, { desdeAno });
            if (vinculos.length) retirados.push({ ...r, vinculos });
            else resultados.push(r);
        }
        renderResultados(resultados, avaliados);
        renderRetirados(retirados);
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

    function renderRetirados(retirados) {
        const box = $('#retirados');
        box.classList.toggle('hidden', !retirados.length);
        $('#retiradosLista').innerHTML = retirados.map((r) => {
            const url = urlLattes(r.pessoa);
            const nome = url
                ? `<a href="${url}" target="_blank" rel="noopener" class="hover:underline">${esc(r.pessoa.nome)}</a>`
                : esc(r.pessoa.nome);
            const itens = r.vinculos.map((v) => `<li>
                <span class="badge ${v.certeza === 'confirmado' ? 'vinculo-confirmado' : 'vinculo-provavel'}">${v.certeza === 'confirmado' ? 'confirmado' : 'provável'}</span>
                ${esc(descreverVinculo(v))}</li>`).join('');
            return `<li>
                <p class="font-semibold">${nome} <span class="font-mono font-normal text-sm">(${fmt.format(r.score)})</span></p>
                <ul class="text-sm space-y-1 mt-1">${itens}</ul>
            </li>`;
        }).join('');
    }

    function renderResultados(resultados, avaliados) {
        const sec = $('#resultado');
        sec.classList.remove('hidden');
        $('#resultadoResumo').textContent = resultados.length
            ? `${resultados.length} de ${avaliados} currículo(s) avaliado(s), da maior para a menor proximidade (0 a 1), sem vínculo identificado.`
            : `Nenhum dos ${avaliados} currículo(s) avaliado(s) tem termos em comum com o trabalho informado sem ter vínculo com a pessoa discente ou com a orientação.`;
        $('#resultadoLista').innerHTML = resultados.map((r, i) => {
            const p = r.pessoa;
            const url = urlLattes(p);
            const pct = Math.round(r.score * 100);
            const nome = url
                ? `<a href="${url}" target="_blank" rel="noopener" class="hover:underline">${esc(p.nome)}</a>`
                : esc(p.nome);
            const detalhes = [
                p.titulacao,
                [p.instituicao, p.uf].filter(Boolean).join(' / '),
                `${p.bancasMestrado} banca(s) de mestrado no Lattes`,
                p.atualizacao ? `currículo atualizado em ${dataBR(p.atualizacao)}` : '',
            ].filter(Boolean);
            const termos = r.termos.map((t) => `<span class="badge bg-brand-50 dark:bg-gray-700 border border-brand-100 dark:border-gray-600">${esc(t)}</span>`).join(' ');
            return `<li class="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                <div class="flex items-start gap-3">
                    <span class="font-mono text-sm font-bold text-gray-500 dark:text-gray-400 w-6 shrink-0">${i + 1}º</span>
                    <div class="flex-1 min-w-0 space-y-2">
                        <div class="flex flex-wrap items-baseline justify-between gap-2">
                            <h3 class="font-semibold text-brand-600 dark:text-accent-400">${nome}</h3>
                            <span class="font-mono font-bold" aria-label="Proximidade ${fmt.format(r.score)} numa escala de 0 a 1">${fmt.format(r.score)}</span>
                        </div>
                        <div class="score-bar" aria-hidden="true"><span style="width:${pct}%"></span></div>
                        <p class="text-sm text-gray-600 dark:text-gray-400">${esc(detalhes.join(' · '))}</p>
                        ${termos ? `<p class="text-sm flex flex-wrap items-center gap-1"><span class="text-gray-600 dark:text-gray-400">Termos em comum:</span> ${termos}</p>` : ''}
                    </div>
                </div>
            </li>`;
        }).join('');
        sec.focus();
    }

    /* -------------------------------- início ------------------------------ */
    function init() {
        $('#buscaForm').addEventListener('submit', buscar);
        for (const id of ['#arquivosInput', '#pastaInput']) {
            $(id).addEventListener('change', (e) => { adicionarArquivos(e.target.files); e.target.value = ''; });
        }
        for (const env of ENVOLVIDOS) {
            $(`#${env.chave}Arquivo`).addEventListener('change', (e) => lerEnvolvido(env, e.target.files[0]));
            $(`#${env.chave}Id`).addEventListener('input', () => {
                if (!lidosDeArquivo[env.chave]) $(`#${env.chave}Status`).textContent = '';
            });
        }
        $('#limparLocaisBtn').addEventListener('click', () => {
            locais = [];
            $('#cargaStatus').textContent = 'Currículos adicionados do seu computador removidos.';
            reindexar();
        });
        carregarDoServidor();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
