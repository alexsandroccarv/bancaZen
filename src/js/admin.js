/* ==========================================================================
   bancaZen — área de administração (seção Administração do index.html)
   --------------------------------------------------------------------------
   Entrada por senha; cadastro unificado de docentes e currículos (CSV da
   lista de docentes e XML/ZIP do Lattes, arquivos ou pasta) com PPG,
   instituição e situação; tabelas da lista e da base; correção e remoção.
   A lista da banca vem do PPG (PROFIAP -> Rede PROFIAP; outro -> Externa).
   Toda a regra (mesmo ID, guarda fora da área pública) fica no servidor:
   api/admin.php.
   ========================================================================== */
(function () {
    const $ = (s) => document.querySelector(s);
    const API = 'api/admin.php?acao=';
    // PHP aceita 20 arquivos por requisição (max_file_uploads) e 8 MB por
    // POST (post_max_size) na configuração padrão: envia em lotes menores.
    const LOTE_ARQUIVOS = 15;
    const LOTE_BYTES = 6 * 1024 * 1024;
    // Lista da banca, calculada do PPG (a mesma regra de bb_grupo_do_ppg).
    const BANCAS = { profiap: 'Rede PROFIAP', outro: 'Externa' };
    const bancaDoPpg = (ppg) => semAcento(String(ppg || '').trim()) === 'profiap' ? 'profiap' : 'outro';

    let csrf = null;
    let base = [];
    let docentes = [];
    let escolhidos = [];

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    function dataBR(iso) {
        return /^\d{4}-\d{2}-\d{2}/.test(iso || '') ? iso.slice(0, 10).split('-').reverse().join('/') : '';
    }
    function semAcento(s) {
        return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    }

    async function api(acao, corpo) {
        const opts = corpo
            ? { method: 'POST', body: corpo, headers: { 'X-CSRF': csrf || '' }, credentials: 'same-origin' }
            : { credentials: 'same-origin', cache: 'no-store' };
        const r = await fetch(API + acao, opts);
        const dados = await r.json().catch(() => ({ erro: `Erro ${r.status} no servidor.` }));
        if (r.status === 401 && acao !== 'entrar') { mostrarEntrada('Sessão expirada. Entre de novo.'); throw new Error('sessão'); }
        if (!r.ok || dados.erro) throw new Error(dados.erro || `Erro ${r.status} no servidor.`);
        return dados;
    }
    function form(obj) {
        const fd = new FormData();
        for (const [k, v] of Object.entries(obj)) fd.append(k, v);
        return fd;
    }

    /* ------------------------------- sessão ------------------------------- */
    function mostrarEntrada(msg) {
        csrf = null;
        $('#painel').classList.add('hidden');
        $('#entrada').classList.remove('hidden');
        $('#entradaMsg').textContent = msg || '';
        $('#senhaInput').focus();
    }
    function mostrarPainel() {
        $('#entrada').classList.add('hidden');
        $('#painel').classList.remove('hidden');
        listar();
        listarDocentes();
    }
    async function iniciarSessao() {
        try {
            const s = await api('sessao');
            if (!s.configurado) { mostrarEntrada('A senha da administração ainda não foi definida no servidor (php api/cli/definir-senha.php).'); return; }
            if (s.logado) { csrf = s.csrf; mostrarPainel(); } else mostrarEntrada('');
        } catch (e) {
            if (e.message !== 'sessão') mostrarEntrada(`Não foi possível falar com o servidor: ${e.message}`);
        }
    }

    /* ------------------------------- envio -------------------------------- */
    const ehCsv = (f) => /\.csv$/i.test(f.name);
    const ehCurriculo = (f) => /\.(xml|zip)$/i.test(f.name);
    function escolher(files) {
        escolhidos = [...files].filter((f) => ehCsv(f) || ehCurriculo(f));
        const nCsv = escolhidos.filter(ehCsv).length;
        const nCv = escolhidos.length - nCsv;
        $('#selecionados').textContent = escolhidos.length
            ? [nCsv ? `${nCsv} lista(s) CSV` : '', nCv ? `${nCv} currículo(s) XML/ZIP` : ''].filter(Boolean).join(' e ') + ' escolhido(s).'
            : 'Nenhum arquivo .csv, .xml ou .zip na seleção.';
        $('#enviarBtn').disabled = !escolhidos.length;
    }
    function mostrarBancaDoPpg() {
        const ppg = $('#ppgInput').value.trim();
        $('#ppgAjuda').textContent = ppg ? `Entra na lista da banca: ${BANCAS[bancaDoPpg(ppg)]}.` : 'Informe o PPG.';
    }
    function lotes(arquivos) {
        const out = [];
        let atual = [], bytes = 0;
        for (const f of arquivos) {
            if (atual.length && (atual.length >= LOTE_ARQUIVOS || bytes + f.size > LOTE_BYTES)) { out.push(atual); atual = []; bytes = 0; }
            atual.push(f); bytes += f.size;
        }
        if (atual.length) out.push(atual);
        return out;
    }
    const SITUACAO = {
        novo: (r) => `incluído: ${r.nome}`,
        substituido: (r) => `substituído pela versão mais recente: ${r.nome} (${dataBR(r.atualizacaoAnterior)} → ${dataBR(r.atualizacao)})`,
        mantido: (r) => `mantido o currículo já cadastrado, que é mais recente: ${r.nome} (cadastrado ${dataBR(r.atualizacaoAnterior)}, enviado ${dataBR(r.atualizacao)})`,
        erro: (r) => `ignorado: ${r.mensagem}`,
    };
    function relatorioLista(nome, r) {
        return `<p class="font-medium">Lista ${esc(nome)}: ${r.importados} docente(s) de ${r.linhas} linha(s)
            (${r.novos} novo(s), ${r.atualizados} atualizado(s)${r.removidos ? `, ${r.removidos} retirado(s) da lista anterior` : ''}).</p>
            <ul class="list-disc list-inside">
                ${r.duplicados ? `<li>${r.duplicados} pessoa(s) repetida(s) no arquivo foram unidas (prevalece a situação Permanente).</li>` : ''}
                ${r.semLattes.length ? `<li>Sem Lattes, não importado(s): ${esc(r.semLattes.join('; '))}.</li>` : ''}
                ${r.exemplos ? `<li>${r.exemplos} linha(s) de exemplo do modelo ignorada(s).</li>` : ''}
                ${r.semSituacao ? `<li>${r.semSituacao} sem situação no programa reconhecida.</li>` : ''}
                ${r.colunasDescartadas.length ? `<li>Colunas não guardadas: ${esc(r.colunasDescartadas.join(', '))}.</li>` : ''}
            </ul>`;
    }

    // Um envio só: primeiro as listas CSV (para os dados da lista já valerem
    // para os currículos), depois os XML/ZIP em lotes.
    async function enviar(ev) {
        ev.preventDefault();
        const ppg = $('#ppgInput').value.trim();
        const rel = $('#relatorio');
        if (!ppg) { rel.innerHTML = '<p class="text-red-700 dark:text-red-400">Informe o PPG.</p>'; $('#ppgInput').focus(); return; }
        const btn = $('#enviarBtn');
        btn.disabled = true;
        const partesHtml = [];
        const mostrar = (andamento) => { rel.innerHTML = partesHtml.join('') + (andamento ? `<p>${esc(andamento)}</p>` : ''); };
        try {
            for (const f of escolhidos.filter(ehCsv)) {
                mostrar(`Importando a lista ${f.name}…`);
                try {
                    const fd = form({ ppg, substituir: $('#docSubstituirInput').checked ? '1' : '0' });
                    fd.append('arquivo', f);
                    partesHtml.push(relatorioLista(f.name, (await api('importar-docentes', fd)).relatorio));
                } catch (e) {
                    if (e.message === 'sessão') throw e;
                    partesHtml.push(`<p class="text-red-700 dark:text-red-400">Lista ${esc(f.name)}: ${esc(e.message)}</p>`);
                }
            }
            const curriculos = escolhidos.filter(ehCurriculo);
            if (curriculos.length) {
                const linhas = [];
                const partes = lotes(curriculos);
                for (let i = 0; i < partes.length; i++) {
                    mostrar(`Enviando currículos: lote ${i + 1} de ${partes.length}…`);
                    const fd = form({ ppg, instituicao: $('#instInput').value.trim(), situacao: $('#situacaoInput').value });
                    for (const f of partes[i]) fd.append('arquivos[]', f, f.webkitRelativePath || f.name);
                    linhas.push(...(await api('enviar', fd)).relatorio);
                }
                const cont = (st) => linhas.filter((r) => r.situacao === st).length;
                partesHtml.push(`<p class="font-medium">Currículos: ${cont('novo')} incluído(s), ${cont('substituido')} substituído(s), ${cont('mantido')} mantido(s), ${cont('erro')} com erro.</p>
                    <ul class="list-disc list-inside">${linhas.map((r) => `<li>${esc(r.arquivo)}: ${esc(SITUACAO[r.situacao](r))}</li>`).join('')}</ul>`);
            }
            mostrar('');
            escolher([]);
            listar();
            listarDocentes();
        } catch (e) {
            if (e.message !== 'sessão') { partesHtml.push(`<p class="text-red-700 dark:text-red-400">${esc(e.message)}</p>`); mostrar(''); }
        } finally {
            btn.disabled = !escolhidos.length;
        }
    }

    /* ------------------------------- base --------------------------------- */
    async function listar() {
        try {
            base = (await api('listar')).curriculos;
        } catch (e) {
            return;
        }
        $('#totalBase').textContent = `(${base.length})`;
        // Sugestões de PPG e instituição a partir do que já foi cadastrado.
        const unicos = (k) => [...new Set(base.map((p) => p[k]).filter(Boolean))].sort();
        $('#ppgLista').innerHTML = unicos('ppg').map((v) => `<option value="${esc(v)}">`).join('');
        $('#instLista').innerHTML = unicos('universidade').map((v) => `<option value="${esc(v)}">`).join('');
        renderTabela();
    }

    /* ------------------------- lista de docentes -------------------------- */
    async function listarDocentes() {
        try {
            docentes = (await api('docentes')).docentes;
        } catch (e) {
            return;
        }
        renderDocentes();
    }

    function renderDocentes() {
        const com = docentes.filter((d) => d.temCurriculo).length;
        $('#docTotais').textContent = docentes.length
            ? `${docentes.length} docente(s) na lista: ${com} com currículo enviado, ${docentes.length - com} sem currículo.`
            : 'Nenhuma lista de docentes importada.';
        const filtro = semAcento($('#docFiltroInput').value);
        const pendentes = $('#docPendentesInput').checked;
        const lista = docentes.filter((d) => (!pendentes || !d.temCurriculo)
            && (!filtro || semAcento(`${d.nome} ${d.universidade} ${d.ppg} ${BANCAS[d.grupo]} ${d.situacao}`).includes(filtro)));
        const tbody = $('#docTabela');
        if (!lista.length) {
            tbody.innerHTML = `<tr><td colspan="7" class="py-3 text-gray-500 dark:text-gray-400">${docentes.length ? 'Nenhum docente corresponde ao filtro.' : 'Envie um CSV com a lista para vê-la aqui.'}</td></tr>`;
            return;
        }
        tbody.innerHTML = lista.map((d) => `<tr class="border-b border-gray-200 dark:border-gray-700">
            <td class="py-2 pr-3">${esc(d.nome)}</td>
            <td class="py-2 pr-3">${esc(d.universidade) || '—'}</td>
            <td class="py-2 pr-3">${esc(d.ppg)}</td>
            <td class="py-2 pr-3">${esc(BANCAS[d.grupo] || '')}</td>
            <td class="py-2 pr-3">${esc(d.situacao) || '—'}</td>
            <td class="py-2 pr-3"><a href="https://lattes.cnpq.br/${esc(d.id)}" target="_blank" rel="noopener" class="text-brand-600 dark:text-accent-400 hover:underline font-mono">${esc(d.id)}</a></td>
            <td class="py-2 whitespace-nowrap">${d.temCurriculo
                ? '<i aria-hidden="true" class="fa-solid fa-circle-check text-green-700 dark:text-green-400"></i> enviado'
                : '<i aria-hidden="true" class="fa-regular fa-clock text-gray-500"></i> pendente'}</td>
        </tr>`).join('');
    }

    function renderTabela() {
        const filtro = semAcento($('#filtroInput').value);
        const lista = base.filter((p) => !filtro || semAcento(`${p.nome} ${p.ppg} ${p.universidade} ${p.situacao}`).includes(filtro));
        const tbody = $('#baseTabela');
        if (!lista.length) {
            tbody.innerHTML = `<tr><td colspan="6" class="py-3 text-gray-500 dark:text-gray-400">${base.length ? 'Nenhum currículo corresponde ao filtro.' : 'Nenhum currículo cadastrado.'}</td></tr>`;
            return;
        }
        tbody.innerHTML = lista.map((p) => `<tr class="border-b border-gray-200 dark:border-gray-700" data-id="${esc(p.id)}">
            <td class="py-2 pr-3"><a href="https://lattes.cnpq.br/${esc(p.id)}" target="_blank" rel="noopener" class="text-brand-600 dark:text-accent-400 hover:underline">${esc(p.nome)}</a></td>
            <td class="py-2 pr-3">${esc(BANCAS[p.grupo] || '')}</td>
            <td class="py-2 pr-3">${esc([p.universidade, p.ppg].filter(Boolean).join(' · '))}${p.naLista ? ' <span class="badge border border-gray-300 dark:border-gray-600" title="Universidade, PPG e situação vêm da lista de docentes">lista</span>' : ''}</td>
            <td class="py-2 pr-3">${esc(p.situacao) || '—'}</td>
            <td class="py-2 pr-3 whitespace-nowrap">${dataBR(p.atualizacao) || '—'}</td>
            <td class="py-2 whitespace-nowrap">
                <button type="button" class="editar text-brand-600 dark:text-accent-400 hover:underline mr-3" aria-label="Editar programa de ${esc(p.nome)}">Editar</button>
                <button type="button" class="remover text-red-700 dark:text-red-400 hover:underline" aria-label="Remover ${esc(p.nome)}">Remover</button>
            </td>
        </tr>`).join('');
    }

    function editar(tr) {
        const p = base.find((x) => x.id === tr.dataset.id);
        const campo = 'px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm';
        tr.innerHTML = `<td class="py-2 pr-3">${esc(p.nome)}</td>
            <td class="py-2 pr-3 text-gray-600 dark:text-gray-400" id="eb-${p.id}" aria-live="polite">${esc(BANCAS[p.grupo] || '')}</td>
            <td class="py-2 pr-3 space-y-1">
                <label class="sr-only" for="ep-${p.id}">PPG</label><input id="ep-${p.id}" list="ppgLista" value="${esc(p.ppg)}" class="${campo} w-full">
                <label class="sr-only" for="ei-${p.id}">Instituição</label><input id="ei-${p.id}" list="instLista" value="${esc(p.universidade)}" class="${campo} w-full"></td>
            <td class="py-2 pr-3"><label class="sr-only" for="es-${p.id}">Situação</label>
                <select id="es-${p.id}" class="${campo}">${['', 'Permanente', 'Colaborador', 'Visitante'].map((v) => `<option value="${v}"${v === p.situacao ? ' selected' : ''}>${v || 'Não informada'}</option>`).join('')}</select></td>
            <td class="py-2 pr-3">${dataBR(p.atualizacao) || '—'}</td>
            <td class="py-2 whitespace-nowrap">
                <button type="button" class="salvar text-brand-600 dark:text-accent-400 hover:underline mr-3">Salvar</button>
                <button type="button" class="cancelar hover:underline">Cancelar</button></td>`;
        // A lista da banca acompanha o PPG digitado.
        $(`#ep-${p.id}`).addEventListener('input', (e) => { $(`#eb-${p.id}`).textContent = BANCAS[bancaDoPpg(e.target.value)]; });
        $(`#ep-${p.id}`).focus();
    }
    async function salvar(tr) {
        const id = tr.dataset.id;
        try {
            await api('programa', form({ id, ppg: $(`#ep-${id}`).value, instituicao: $(`#ei-${id}`).value, situacao: $(`#es-${id}`).value }));
            listar();
        } catch (e) {
            if (e.message !== 'sessão') alert(e.message);
        }
    }
    async function remover(tr) {
        const p = base.find((x) => x.id === tr.dataset.id);
        if (!confirm(`Remover o currículo de ${p.nome}? O XML guardado também será apagado.`)) return;
        try {
            await api('remover', form({ id: p.id }));
            listar();
        } catch (e) {
            if (e.message !== 'sessão') alert(e.message);
        }
    }

    /* ------------------------------- início ------------------------------- */
    function init() {
        $('#entrarForm').addEventListener('submit', async (ev) => {
            ev.preventDefault();
            $('#entradaMsg').textContent = '';
            try {
                const r = await api('entrar', form({ senha: $('#senhaInput').value }));
                csrf = r.csrf;
                $('#senhaInput').value = '';
                mostrarPainel();
            } catch (e) {
                $('#entradaMsg').textContent = e.message;
            }
        });
        $('#sairBtn').addEventListener('click', async () => {
            try { await api('sair', form({})); } catch (_) { /* já saiu */ }
            mostrarEntrada('');
        });
        for (const id of ['#arquivosInput', '#pastaInput']) {
            $(id).addEventListener('change', (e) => { escolher(e.target.files); e.target.value = ''; });
        }
        $('#ppgInput').addEventListener('input', mostrarBancaDoPpg);
        mostrarBancaDoPpg();
        $('#envioForm').addEventListener('submit', enviar);
        $('#docFiltroInput').addEventListener('input', renderDocentes);
        $('#docPendentesInput').addEventListener('change', renderDocentes);
        $('#filtroInput').addEventListener('input', renderTabela);
        $('#baseTabela').addEventListener('click', (e) => {
            const tr = e.target.closest('tr[data-id]');
            if (!tr) return;
            if (e.target.closest('.editar')) editar(tr);
            else if (e.target.closest('.remover')) remover(tr);
            else if (e.target.closest('.salvar')) salvar(tr);
            else if (e.target.closest('.cancelar')) renderTabela();
        });
        // Só consulta o servidor quando a seção é aberta (e uma vez só).
        let iniciada = false;
        const abrir = () => { if (!iniciada) { iniciada = true; iniciarSessao(); } };
        document.addEventListener('tab:change', (e) => { if (e.detail && e.detail.tab === 'administracao') abrir(); });
        if (!$('#tab-administracao').hidden) abrir(); // aberta direto por index.html#administracao
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
