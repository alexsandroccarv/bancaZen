/* ==========================================================================
   bancaZen — seção Relatório (index.html#relatorio)
   --------------------------------------------------------------------------
   Declaração da indicação dos membros da Banca de Defesa de Projeto de TCC
   ou de Defesa de TCC, para anexar ao pedido de aprovação ao Comitê Gestor
   Nacional (Normas Acadêmicas do PROFIAP, item 13). Usa o último resultado
   da busca (evento "busca:resultado" de app.js) e os dados de Meu TCC. É montada no
   navegador e impressa ou salva em PDF; nada é enviado ao servidor.

   A declaração ética segue o que a busca de fato verificou: com currículos,
   só pelo nome (parcial) ou sem verificação (aí a ausência de vínculo é
   declarada por quem assina, sem atribuí-la à ferramenta).
   ========================================================================== */
(function () {
    const $ = (s) => document.querySelector(s);
    const fmt = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const MESES_ABNT = ['jan.', 'fev.', 'mar.', 'abr.', 'maio', 'jun.', 'jul.', 'ago.', 'set.', 'out.', 'nov.', 'dez.'];
    const PAPEIS_BANCA = { titular: 'Titular', suplente: 'Suplente' };
    const BANCAS = { tcc: 'Banca de Defesa de TCC', projeto: 'Banca de Defesa de Projeto de TCC' };

    let resultado = null;

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    const dataExtenso = (d) => d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
    const dataHora = (d) => `${d.toLocaleDateString('pt-BR')} às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    const dataAbnt = (d) => `${d.getDate()} ${MESES_ABNT[d.getMonth()]} ${d.getFullYear()}`;
    // Lista em português: "A", "A e B", "A, B e C".
    const juntar = (xs) => xs.length <= 1 ? (xs[0] || '') : `${xs.slice(0, -1).join(', ')} e ${xs[xs.length - 1]}`;
    const enderecoSite = () => location.origin + location.pathname.replace(/index\.html$/, '');

    /* ------------------------- escolha das pessoas ------------------------ */
    function chave(p) {
        return p.id || p.nome;
    }
    function renderEscolhas() {
        const caixa = $('#relEscolhas');
        caixa.innerHTML = resultado.listas.map((l) => {
            if (!l.resultados.length) return `<p class="text-gray-600 dark:text-gray-400">${esc(l.titulo)}: sem indicações.</p>`;
            const itens = l.resultados.map((r, i) => {
                const p = r.pessoa;
                const id = `rel-${l.grupo}-${i}`;
                return `<li class="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <label class="flex items-center gap-2 min-w-0 flex-1">
                        <input type="checkbox" id="${id}" data-chave="${esc(chave(p))}">
                        <span>${i + 1}. ${esc(p.nome)} <span class="text-gray-600 dark:text-gray-400">(${esc(p.universidade || p.instituicao || '')}; índice ${fmt.format(r.score)})</span></span>
                    </label>
                    <label class="sr-only" for="${id}-papel">Papel de ${esc(p.nome)} na banca</label>
                    <select id="${id}-papel" data-papel-de="${esc(chave(p))}" class="text-sm px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800">
                        <option value="titular">Titular</option>
                        <option value="suplente">Suplente</option>
                    </select>
                </li>`;
            }).join('');
            return `<div><p class="font-semibold">${esc(l.titulo)}</p><ul class="space-y-1 mt-1">${itens}</ul></div>`;
        }).join('');
    }
    function escolhidas() {
        const lista = [];
        for (const l of resultado.listas) {
            l.resultados.forEach((r, i) => {
                const k = chave(r.pessoa);
                const marcado = document.querySelector(`#relEscolhas input[data-chave="${CSS.escape(k)}"]`);
                if (marcado && marcado.checked) {
                    const papel = document.querySelector(`#relEscolhas select[data-papel-de="${CSS.escape(k)}"]`).value;
                    lista.push({ ...r, lista: l.titulo, posicao: i + 1, papel });
                }
            });
        }
        // Titulares antes de suplentes; em cada grupo, pela ordem das listas.
        return lista.sort((a, b) => (a.papel === b.papel ? 0 : a.papel === 'titular' ? -1 : 1));
    }

    /* ------------------------------ documento ----------------------------- */
    function paragrafoEtico(c, retirados) {
        const considerados = (c && c.considerados) || [];
        const vinculos = 'coautoria em publicações, relação de orientação ou identidade de pessoa';
        const declaracao = 'a ausência de parentesco de 1º grau e de vínculo pré-existente que possa representar conflito de interesses com os membros indicados';
        // Sem currículo nem nome da autoria e da orientação, a ferramenta não
        // verificou vínculos: o texto não atribui a ela essa verificação.
        if (!considerados.length) {
            return `<p>Foram observadas as vedações do item 13.3 das Normas Acadêmicas. A verificação automática de vínculos
                não foi realizada, pois os currículos e os nomes da autoria e da orientação não foram informados na
                ferramenta. Declaro ${declaracao} (${vinculos}), com a autoria do trabalho e com a orientação.</p>`;
        }
        return `<p>Foram observadas as vedações do item 13.3 das Normas Acadêmicas. A ferramenta retirou das indicações os
            currículos com vínculo pré-existente (${vinculos}) com a autoria do trabalho ou com a orientação.
            ${retirados === 1 ? '1 indicação foi retirada' : `${retirados} indicações foram retiradas`} por esse motivo.
            Declaro também ${declaracao}.</p>`;
    }
    function tabelaIndicacoes(l, marcadas) {
        if (!l.resultados.length) return `<p><strong>${esc(l.titulo)}:</strong> sem indicações.</p>`;
        const linhas = l.resultados.map((r, i) => {
            const p = r.pessoa;
            const m = marcadas.get(chave(p));
            return `<tr${m ? ' class="doc-escolhida"' : ''}>
                <td>${i + 1}</td><td>${esc(p.nome)}</td><td>${esc(p.universidade || p.instituicao || '')}</td>
                <td>${esc(p.ppg || '')}</td><td class="doc-num">${fmt.format(r.score)}</td><td>${m ? esc(PAPEIS_BANCA[m.papel]) : ''}</td>
            </tr>`;
        }).join('');
        return `<table class="doc-tabela">
            <caption>${esc(l.titulo)}</caption>
            <thead><tr><th scope="col">Nº</th><th scope="col">Nome</th><th scope="col">Universidade</th><th scope="col">PPG</th><th scope="col">Índice</th><th scope="col">Escolha</th></tr></thead>
            <tbody>${linhas}</tbody>
        </table>`;
    }
    function gerar(ev) {
        ev.preventDefault();
        const aviso = $('#relAviso');
        const lista = escolhidas();
        if (!lista.length) {
            aviso.innerHTML = '<p class="text-red-700 dark:text-red-400">Marque ao menos uma indicação para a composição da banca.</p>';
            return;
        }
        // Dados atuais de Meu TCC; o que foi usado na busca completa o que faltar.
        const atual = window.BancaZen ? window.BancaZen.dadosDissertacao() : {};
        const d = Object.fromEntries(Object.keys({ ...resultado.dissertacao, ...atual }).map((k) => [k, atual[k] || resultado.dissertacao[k] || '']));
        const considerados = resultado.conformidade.considerados || [];
        const nomeDe = (papel) => d[papel] || (considerados.find((p) => p.chave === papel) || {}).nome || '';
        const orientador = nomeDe('orientador');
        const coorientador = nomeDe('coorientador');
        const banca = BANCAS[$('#relTipoInput').value] || BANCAS.tcc;
        const programa = $('#relProgramaInput').value.trim();
        const local = $('#relLocalInput').value.trim();
        const agora = new Date();
        const marcadas = new Map(lista.map((x) => [chave(x.pessoa), x]));
        const retirados = resultado.listas.reduce((n, l) => n + (l.retirados || []).length, 0);
        const cr = resultado.criterios;
        const criterios = [
            cr.excluirInstituicao ? 'desconsiderados os currículos de docentes da Instituição Associada' : '',
            cr.somenteDoutores ? 'somente docentes com o grau de doutor' : '',
            cr.periodo ? `coautorias dos últimos ${cr.periodo} anos` : 'coautorias de todo o período',
        ].filter(Boolean);
        const faltando = [!d.nome && 'o seu nome', !d.titulo && 'o título do trabalho', !orientador && 'o nome de quem orienta'].filter(Boolean);
        aviso.innerHTML = [
            faltando.length ? `<p class="text-amber-800 dark:text-amber-300">Faltam ${juntar(faltando)} (em Meu TCC); o documento sai com espaço em branco.</p>` : '',
            !considerados.length ? '<p class="text-amber-800 dark:text-amber-300">A busca foi feita sem "Orientação": o relatório informa que a verificação automática de vínculos não foi realizada. Para incluí-la, preencha Orientação em Meu TCC e busque de novo.</p>' : '',
        ].join('');
        const versao = (window.APP_CONFIG && window.APP_CONFIG.version) || '';
        const autor = (window.APP_CONFIG && window.APP_CONFIG.author && window.APP_CONFIG.author.nome) || '';
        const partesAutor = autor.trim().split(/\s+/);
        const autorAbnt = partesAutor.length > 1 ? `${partesAutor.pop().toUpperCase()}, ${partesAutor.join(' ')}` : autor;
        const branco = '______________________________';

        const doc = $('#relDocumento');
        doc.innerHTML = `
            <div class="doc-cabecalho">
                <p>${esc(d.universidade || branco)}</p>
                <p>${esc(programa || branco)}</p>
            </div>
            <h3 class="doc-titulo">Declaração de indicação dos membros da ${esc(banca)}</h3>
            <dl class="doc-identificacao">
                <dt>Discente</dt><dd>${esc(d.nome || branco)}</dd>
                <dt>TCC</dt><dd>${esc(d.titulo || branco)}</dd>
                <dt>Orientação</dt><dd>${esc(orientador || branco)}</dd>
                ${coorientador ? `<dt>Coorientação</dt><dd>${esc(coorientador)}</dd>` : ''}
            </dl>
            <p>A escolha dos membros da ${esc(banca)} seguiu um processo objetivo de indicação, conforme o item 13 das Normas
                Acadêmicas Nacionais do PROFIAP, apoiado pela ferramenta bancaZen, desenvolvida por ${esc(autor)} e disponível
                em ${esc(enderecoSite())}.</p>
            <p>A ferramenta comparou o título, o resumo e as palavras-chave do TCC com os currículos Lattes cadastrados,
                pelo modelo BM25, e calculou para cada docente um índice de proximidade temática de 0 a 1, em apoio ao
                item 13.2. As indicações foram apresentadas em duas listas, em ordem decrescente do índice: Rede PROFIAP,
                de docentes permanentes credenciados da Rede PROFIAP (item 13.1, alínea b), e Programa externo à Rede
                PROFIAP (item 13.1, alínea c). Critérios da busca: ${esc(criterios.join('; '))}.</p>
            ${paragrafoEtico(resultado.conformidade, retirados)}
            <div class="doc-escolhidas">
                <h4 class="doc-subtitulo">Composição proposta</h4>
                <ol>
                    ${orientador ? `<li><strong>${esc(orientador)}</strong>, orientação (item 13.1, alínea a)</li>` : ''}
                    ${lista.map((x) => `<li><strong>${esc(x.pessoa.nome)}</strong>, ${esc(x.pessoa.universidade || x.pessoa.instituicao || '')};
                        ${esc(x.lista)}
                        <span class="doc-papel">${esc(PAPEIS_BANCA[x.papel])}</span></li>`).join('')}
                </ol>
            </div>
            <p class="doc-local">${esc(local || branco)}, ${esc(dataExtenso(agora))}.</p>
            <div class="doc-assinaturas">
                <div><span class="doc-linha-assinatura"></span>${esc(d.nome || 'Discente')}<br><small>Discente</small></div>
                <div><span class="doc-linha-assinatura"></span>${esc(orientador || 'Orientação')}<br><small>Orientação</small></div>
            </div>
            <div class="doc-anexo">
                <h4 class="doc-subtitulo">Indicações do bancaZen</h4>
                <p class="doc-nota">Busca realizada em ${esc(dataHora(resultado.em))}. Índice de proximidade de 0 a 1; em negrito, os nomes da composição proposta.</p>
                ${resultado.listas.map((l) => tabelaIndicacoes(l, marcadas)).join('')}
            </div>
            <div class="doc-rodape">
                <p>Documento gerado em ${esc(dataHora(agora))} pelo bancaZen ${esc(versao)} (${esc(enderecoSite())}).</p>
                <p><strong>Como citar o bancaZen:</strong> ${esc(autorAbnt)}. <em>bancaZen</em>: indicação de docentes para
                    as bancas de defesa do PROFIAP. Versão ${esc(versao.replace(/^v/, ''))}. ${agora.getFullYear()}.
                    Disponível em: ${esc(enderecoSite())}. Acesso em: ${esc(dataAbnt(agora))}.</p>
            </div>`;
        doc.hidden = false;
        $('#relAcoes').hidden = false;
        doc.scrollIntoView({ block: 'start' });
    }

    /* -------------------------------- início ------------------------------ */
    function init() {
        document.addEventListener('busca:resultado', (e) => {
            resultado = e.detail;
            $('#relSemBusca').hidden = true;
            $('#relForm').hidden = false;
            $('#relDocumento').hidden = true;
            $('#relAcoes').hidden = true;
            $('#relAviso').innerHTML = '';
            renderEscolhas();
        });
        $('#relForm').addEventListener('submit', gerar);
        $('#relImprimirBtn').addEventListener('click', () => window.print());
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
