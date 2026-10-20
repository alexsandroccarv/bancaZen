/* ==========================================================================
   BuscaBanca — aplicação (abas "Indicar banca" e "Currículos")
   --------------------------------------------------------------------------
   1. Carrega data/corpus.json (gerado pelo build a partir da pasta lattes/).
   2. Permite acrescentar XML/ZIP do computador (lidos só no navegador).
   3. Recebe título, resumo e palavras-chave e exibe as 10 pessoas com maior
      proximidade temática (0 a 1), em ordem decrescente.
   Depende de: lattes-corpus.js (window.LattesCorpus) e similaridade.js
   (window.Similaridade).
   ========================================================================== */
(function () {
    const LIMITE = 10;
    const $ = (s) => document.querySelector(s);

    let doServidor = [];
    let locais = [];
    let indice = null;

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
        if (!indice) return;
        const { resultados, avaliados } = window.Similaridade.buscar(indice, consulta, {
            limite: LIMITE,
            excluirInstituicao: $('#excluirInput').value,
            somenteDoutores: $('#doutoresInput').checked,
        });
        renderResultados(resultados, avaliados);
    }

    function renderResultados(resultados, avaliados) {
        const sec = $('#resultado');
        sec.classList.remove('hidden');
        $('#resultadoResumo').textContent = resultados.length
            ? `${resultados.length} de ${avaliados} currículo(s) avaliado(s), da maior para a menor proximidade (0 a 1).`
            : `Nenhum dos ${avaliados} currículo(s) avaliado(s) tem termos em comum com o trabalho informado.`;
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
