/* ==========================================================================
   bancaZen — área de administração (painel da engrenagem do index.html,
   trecho #administracao)
   --------------------------------------------------------------------------
   Entrada por senha; cadastro unificado de docentes e currículos (CSV da
   planilha de docentes e XML/ZIP do Lattes, arquivos ou pasta; os dados vêm
   da planilha); conferência XML x planilha; inclusão na busca dos XMLs copiados direto para
   o servidor (rsync/FTP), em lotes; tabelas da lista e da base; correção
   e remoção.
   A lista da banca vem do PPG (PROFIAP -> Rede PROFIAP; outro -> Programa externo à Rede PROFIAP).
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
    const BANCAS = { profiap: 'Rede PROFIAP', outro: 'Programa externo à Rede PROFIAP' };
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
    async function api(acao, corpo) {
        const opts = corpo
            ? { method: 'POST', body: corpo, headers: { 'X-CSRF': csrf || '' }, credentials: 'same-origin' }
            : { credentials: 'same-origin', cache: 'no-store' };
        const r = await fetch(API + acao, opts);
        const dados = await lerResposta(r);
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
        // Confere o índice de busca em segundo plano (só refaz se a base mudou).
        atualizarIndice([]).catch(() => {});
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
                ${r.ppgPadrao ? `<li>${r.ppgPadrao} linha(s) sem PPG ficaram com PROFIAP.</li>` : ''}
                ${r.emailInvalido ? `<li>${r.emailInvalido} e-mail(s) inválido(s) ignorado(s).</li>` : ''}
                ${r.idCientifico && r.idCientifico.length ? `<li>ID Lattes em notação científica do Excel (ex.: 1,53319E+15), sem como recuperar: ${esc(r.idCientifico.join('; '))}. Formate a coluna como Texto ou use o link do Lattes.</li>` : ''}
                ${r.idDivergente && r.idDivergente.length ? `<li>ID diferente entre o número e o link do Lattes (vale o link, porque o Excel arredonda números de 16 dígitos): ${esc(r.idDivergente.join('; '))}.</li>` : ''}
                ${r.colunasDescartadas.length ? `<li>Colunas não guardadas: ${esc(r.colunasDescartadas.join(', '))}.</li>` : ''}
            </ul>`;
    }

    // Um envio só: primeiro as listas CSV (para os dados da lista já valerem
    // para os currículos), depois os XML/ZIP em lotes.
    async function enviar(ev) {
        ev.preventDefault();
        const rel = $('#relatorio');
        const btn = $('#enviarBtn');
        btn.disabled = true;
        const partesHtml = [];
        const mostrar = (andamento) => { rel.innerHTML = partesHtml.join('') + (andamento ? `<p>${esc(andamento)}</p>` : ''); };
        try {
            for (const f of escolhidos.filter(ehCsv)) {
                mostrar(`Importando a lista ${f.name}…`);
                try {
                    const fd = form({});
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
                    const fd = form({});
                    for (const f of partes[i]) fd.append('arquivos[]', f, f.webkitRelativePath || f.name);
                    linhas.push(...(await api('enviar', fd)).relatorio);
                }
                const cont = (st) => linhas.filter((r) => r.situacao === st).length;
                const semDados = linhas.filter((r) => r.semDados).length;
                partesHtml.push(`<p class="font-medium">Currículos: ${cont('novo')} incluído(s), ${cont('substituido')} substituído(s), ${cont('mantido')} mantido(s), ${cont('erro')} com erro.${semDados ? ` ${semDados} sem dados na planilha (fora da busca).` : ''}</p>
                    <ul class="list-disc list-inside">${linhas.map((r) => `<li>${esc(r.arquivo)}: ${esc(SITUACAO[r.situacao](r))}${r.semDados ? ' (sem dados na planilha)' : ''}</li>`).join('')}</ul>`);
            }
            if (curriculos.length) {
                mostrar('Atualizando o índice de busca…');
                await atualizarIndice(partesHtml);
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

    /* --------------- currículos copiados direto para o servidor ------------- */
    // O servidor processa em lotes (cursor pelo nome do arquivo); aqui os
    // lotes são repetidos até o fim e os relatórios somados.
    async function reindexar(simular) {
        const organizar = !simular && $('#reOrganizarInput').checked;
        if (!simular && !confirm(`Incluir na busca os currículos guardados no servidor?${organizar ? ' As cópias com outro nome serão apagadas depois de incluídas.' : ''}`)) return;
        const rel = $('#reRelatorio');
        const botoes = [$('#reSimularBtn'), $('#reIncluirBtn')];
        botoes.forEach((b) => { b.disabled = true; });
        const soma = { lidos: 0, novo: 0, substituido: 0, mantido: 0, organizados: 0, copias: 0, erros: [], semPpg: new Map(), pessoas: new Map() };
        let r = null;
        let indiceAtual = null;
        let depois = '';
        try {
            do {
                rel.innerHTML = `<p>${simular ? 'Simulando' : 'Incluindo'}: ${soma.lidos} de ${r ? r.totalArquivos : '…'} arquivo(s) lido(s)…</p>`;
                r = (await api('reindexar', form({
                    simular: simular ? '1' : '0', organizar: organizar ? '1' : '0', depois,
                }))).relatorio;
                soma.lidos += r.arquivos;
                for (const k of ['novo', 'substituido', 'mantido', 'organizados']) soma[k] += r[k] || 0;
                soma.copias += r.comOutroNome.length;
                soma.erros.push(...r.erros);
                for (const p of r.semPpg) soma.semPpg.set(p.id, p);
                for (const p of r.pessoas) if (!soma.pessoas.has(p.id)) soma.pessoas.set(p.id, p.situacao);
                if (indiceAtual === null && r.indiceAtual != null) indiceAtual = r.indiceAtual;
                depois = r.ultimo;
            } while (r.restantes > 0 && r.arquivos > 0);
            if (!simular) {
                rel.innerHTML = '<p>Atualizando o índice de busca…</p>';
                const avisos = [];
                await atualizarIndice(avisos);
                rel.innerHTML = relatorioInclusao(soma, r.total) + avisos.join('');
                listar();
                listarDocentes();
            } else {
                rel.innerHTML = relatorioSimulacao(soma, indiceAtual);
            }
        } catch (e) {
            if (e.message !== 'sessão') rel.innerHTML = `<p class="text-red-700 dark:text-red-400">${esc(e.message)}${soma.lidos ? ` (depois de ${soma.lidos} arquivo(s) lido(s); pode repetir)` : ''}</p>`;
        } finally {
            botoes.forEach((b) => { b.disabled = false; });
        }
    }
    function listaSemPpg(soma, verbo) {
        if (!soma.semPpg.size) return '';
        const nomes = [...soma.semPpg.values()].slice(0, 50).map((p) => `<li>${esc(p.nome || '(sem nome)')} <span class="font-mono text-xs">${esc(p.id)}</span> ${esc(p.arquivo)}</li>`).join('');
        return `<p>${soma.semPpg.size} pessoa(s) sem dados ${verbo} guardada(s) fora da busca (não estão na planilha de docentes). Para incluí-las na busca, envie a planilha com elas.</p>
            <ul class="list-disc list-inside">${nomes}${soma.semPpg.size > 50 ? `<li>… e mais ${soma.semPpg.size - 50}</li>` : ''}</ul>`;
    }
    function listaErros(soma) {
        return soma.erros.length ? `<p class="text-red-700 dark:text-red-400">${soma.erros.length} arquivo(s) com erro:</p><ul class="list-disc list-inside">${soma.erros.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>` : '';
    }
    function relatorioSimulacao(soma, indiceAtual) {
        const novos = [...soma.pessoas.values()].filter((s) => s === 'novo').length;
        return `<p class="font-medium">Simulação (nada foi gravado): ${soma.lidos} arquivo(s) lido(s); ${soma.pessoas.size} pessoa(s) seriam guardadas
            (${novos} nova(s), ${soma.pessoas.size - novos} já cadastrada(s)). Currículos guardados: ${indiceAtual ?? 0} → ${(indiceAtual ?? 0) + novos}.</p>
            ${soma.copias ? `<p>${soma.copias} arquivo(s) com outro nome seriam guardados como &lt;ID Lattes&gt;.xml.</p>` : ''}
            ${listaSemPpg(soma, 'ficariam')}${listaErros(soma)}`;
    }
    function relatorioInclusao(soma, total) {
        return `<p class="font-medium">${soma.lidos} arquivo(s) lido(s): ${soma.novo} incluído(s), ${soma.substituido} já cadastrado(s) ou repetido(s), ${soma.mantido} mantido(s) (havia versão mais recente).
            Currículos guardados: ${total}.</p>
            ${soma.organizados ? `<p>${soma.organizados} cópia(s) com outro nome apagada(s).</p>` : soma.copias ? `<p>${soma.copias} arquivo(s) com outro nome continuam na pasta como cópia; para apagá-los, marque a opção acima e inclua de novo.</p>` : ''}
            ${listaSemPpg(soma, 'ficaram')}${listaErros(soma)}`;
    }

    // Índice de busca: montado logo depois das cargas, para a primeira busca
    // das pessoas discentes não esperar por ele.
    async function atualizarIndice(avisos) {
        try {
            const r = await api('indexar', form({}));
            avisos.push(`<p>Índice de busca atualizado: ${r.curriculos} currículo(s).</p>`);
        } catch (e) {
            if (e.message === 'sessão') throw e;
            avisos.push(`<p class="text-red-700 dark:text-red-400">Índice de busca: ${esc(e.message)} A primeira busca vai montá-lo.</p>`);
        }
    }

    /* ---------------------------- zona de risco ---------------------------- */
    function atualizarLimpar() {
        const algo = $('#limparCurriculosInput').checked || $('#limparDocentesInput').checked;
        $('#limparBtn').disabled = !(algo && $('#limparConfirmaInput').value.trim() === 'LIMPAR');
    }
    async function limpar(ev) {
        ev.preventDefault();
        const curriculos = $('#limparCurriculosInput').checked;
        const docs = $('#limparDocentesInput').checked;
        const oQue = [curriculos && 'todos os currículos (índice e arquivos XML)', docs && 'a lista de docentes'].filter(Boolean).join(' e ');
        if (!confirm(`Apagar ${oQue}? Esta ação não pode ser desfeita.`)) return;
        const rel = $('#limparRelatorio');
        $('#limparBtn').disabled = true;
        rel.textContent = 'Apagando…';
        try {
            const r = (await api('limpar', form({ curriculos: curriculos ? '1' : '0', docentes: docs ? '1' : '0', confirmacao: $('#limparConfirmaInput').value.trim() }))).relatorio;
            rel.textContent = [
                curriculos && `${r.curriculos} currículo(s) e ${r.arquivos} arquivo(s) apagado(s).`,
                docs && `${r.docentes} docente(s) retirado(s) da lista.`,
            ].filter(Boolean).join(' ');
            $('#limparForm').reset();
            listar();
            listarDocentes();
        } catch (e) {
            if (e.message !== 'sessão') rel.innerHTML = `<span class="text-red-700 dark:text-red-400">${esc(e.message)}</span>`;
        } finally {
            atualizarLimpar();
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
        renderConferencia();
    }

    /* ------------------------- lista de docentes -------------------------- */
    async function listarDocentes() {
        try {
            docentes = (await api('docentes')).docentes;
        } catch (e) {
            return;
        }
        renderDocentes();
        renderConferencia();
    }

    // Conferência XML x planilha: currículos cujo ID Lattes não está na
    // planilha (destacando os sem PPG, fora da busca) e docentes da planilha
    // ainda sem currículo.
    function renderConferencia() {
        const item = (p) => `<li>${esc(p.nome)} <a href="https://lattes.cnpq.br/${esc(p.id)}" target="_blank" rel="noopener" class="text-brand-600 dark:text-accent-400 hover:underline font-mono text-xs">${esc(p.id)}</a>${p.semDados ? ' <span class="text-xs text-gray-600 dark:text-gray-400">(sem PPG, fora da busca)</span>' : ''}</li>`;
        const preencher = (n, lista, itens, vazio) => {
            $(n).textContent = String(itens.length);
            $(lista).innerHTML = itens.length ? itens.map(item).join('') : `<li class="list-none text-gray-500 dark:text-gray-400">${vazio}</li>`;
        };
        const foraDaPlanilha = base.filter((p) => !p.naLista);
        preencher('#cfSemDadosN', '#cfSemDadosLista', foraDaPlanilha, 'Nenhum: todos os currículos estão na planilha.');
        const fora = foraDaPlanilha.filter((p) => p.semDados).length;
        $('#cfForaBusca').textContent = fora ? `${fora} deles sem PPG, fora da busca.` : (foraDaPlanilha.length ? 'Todos com PPG, na busca.' : '');
        preencher('#cfSemXmlN', '#cfSemXmlLista', docentes.filter((d) => !d.temCurriculo), 'Nenhum: todos da planilha têm currículo.');
    }

    function renderDocentes() {
        const com = docentes.filter((d) => d.temCurriculo).length;
        $('#docTotal').textContent = `(${docentes.length})`;
        $('#docTotais').textContent = docentes.length
            ? `${docentes.length} docente(s) na lista: ${com} com currículo enviado, ${docentes.length - com} sem currículo.`
            : 'Nenhuma lista de docentes importada.';
        const filtro = semAcento($('#docFiltroInput').value);
        const pendentes = $('#docPendentesInput').checked;
        const lista = docentes.filter((d) => (!pendentes || !d.temCurriculo)
            && (!filtro || semAcento(`${d.nome} ${d.universidade} ${d.ppg} ${BANCAS[d.grupo]} ${d.situacao} ${d.email || ''}`).includes(filtro)));
        const caixa = $('#docGrupos');
        if (!lista.length) {
            caixa.innerHTML = `<p class="py-3 text-gray-500 dark:text-gray-400">${docentes.length ? 'Nenhum docente corresponde ao filtro.' : 'Envie a planilha (CSV) para ver a lista aqui.'}</p>`;
            return;
        }
        // Agrupa por banca (Rede PROFIAP, depois programa externo) e, em cada uma, por
        // universidade: o que é comum ao grupo vai no título, não em cada linha.
        const porNome = (a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' });
        caixa.innerHTML = Object.keys(BANCAS).map((g) => {
            const daBanca = lista.filter((d) => d.grupo === g);
            if (!daBanca.length) return '';
            const comCv = daBanca.filter((d) => d.temCurriculo).length;
            const univs = [...new Set(daBanca.map((d) => d.universidade || ''))].sort((a, b) => (!a) - (!b) || porNome(a, b));
            return `<section class="doc-banca" aria-label="${esc(BANCAS[g])}">
                <h4 class="doc-banca-titulo">${esc(BANCAS[g])} <span class="doc-contagem">${daBanca.length} docente(s), ${comCv} com currículo</span></h4>
                ${univs.map((u) => {
                    const pessoas = daBanca.filter((d) => (d.universidade || '') === u).sort((a, b) => porNome(a.nome, b.nome));
                    return `<div class="doc-univ">
                        <h5 class="doc-univ-titulo">${esc(u || 'Universidade não informada')} <span class="doc-contagem">${pessoas.length}</span></h5>
                        <ul class="doc-lista">${pessoas.map((d) => linhaDocente(d, g)).join('')}</ul>
                    </div>`;
                }).join('')}
            </section>`;
        }).join('');
    }
    function linhaDocente(d, grupo) {
        // Na Rede PROFIAP o PPG é sempre PROFIAP: só aparece no programa externo.
        const ppg = grupo === 'outro' && d.ppg ? `<span class="doc-ppg">${esc(d.ppg)}</span>` : '';
        const situacao = d.situacao ? `<span class="doc-situacao">${esc(d.situacao)}</span>` : '';
        // Situação do currículo só com ícone, no início da linha; o texto fica
        // na dica (title) e para leitores de tela.
        const cv = d.temCurriculo ? 'Currículo enviado' : 'Currículo pendente';
        return `<li class="doc-linha">
            <span class="doc-cv ${d.temCurriculo ? 'doc-cv-enviado' : 'doc-cv-pendente'}" title="${cv}"><i aria-hidden="true" class="${d.temCurriculo ? 'fa-solid fa-circle-check text-green-700 dark:text-green-400' : 'fa-regular fa-clock'}"></i><span class="sr-only">${cv}</span></span>
            <span class="doc-nome">${esc(d.nome)} ${situacao}${ppg}</span>
            <a class="doc-lattes text-brand-600 dark:text-accent-400 hover:underline" href="https://lattes.cnpq.br/${esc(d.id)}" target="_blank" rel="noopener" title="ID Lattes ${esc(d.id)}" aria-label="Currículo Lattes de ${esc(d.nome)} (abre em nova aba)"><i aria-hidden="true" class="fa-solid fa-arrow-up-right-from-square"></i> Lattes</a>
            <span class="doc-email">${d.email ? `<a href="mailto:${esc(d.email)}" class="text-brand-600 dark:text-accent-400 hover:underline">${esc(d.email)}</a>` : ''}</span>
        </li>`;
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
            <td class="py-2 pr-3">${p.semDados ? '<span class="text-gray-600 dark:text-gray-400">sem dados (fora da busca)</span>' : esc(BANCAS[p.grupo] || '')}</td>
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
            atualizarIndice([]);
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
        $('#envioForm').addEventListener('submit', enviar);
        $('#reSimularBtn').addEventListener('click', () => reindexar(true));
        $('#reIncluirBtn').addEventListener('click', () => reindexar(false));
        $('#reForm').addEventListener('submit', (ev) => ev.preventDefault());
        for (const id of ['#limparCurriculosInput', '#limparDocentesInput', '#limparConfirmaInput']) $(id).addEventListener('input', atualizarLimpar);
        $('#limparForm').addEventListener('submit', limpar);
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
        // A Administração fica no painel da engrenagem (tab-config).
        document.addEventListener('tab:change', (e) => { if (e.detail && e.detail.tab === 'config') abrir(); });
        if (!$('#tab-config').hidden) abrir(); // aberta direto (ex.: index.html#administracao)
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
