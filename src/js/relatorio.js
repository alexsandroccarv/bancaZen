/* ==========================================================================
   bancaZen — seção Relatório (index.html#relatorio)
   --------------------------------------------------------------------------
   Declaração da indicação da banca, para anexar ao pedido de defesa ou de
   exame de qualificação. Usa o último resultado da busca (evento
   "busca:resultado" de app.js) e os dados de Minha Dissertação. É montada no
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
        const comCurriculo = considerados.filter((p) => !p.soNome).map((p) => `${p.nome} (${p.papel.toLowerCase()})`);
        const soNome = considerados.filter((p) => p.soNome).map((p) => `${p.nome} (${p.papel.toLowerCase()})`);
        const vinculos = 'coautoria em publicações, relação de orientação ou identidade de pessoa';
        if (!considerados.length) {
            return `<p>A verificação automática de vínculos não foi realizada, pois os currículos e os nomes da autoria e da
                orientação não foram informados na ferramenta. Declaro que as pessoas escolhidas não têm vínculo
                pré-existente (${vinculos}) com a autoria do trabalho nem com a orientação.</p>`;
        }
        const fontes = [];
        if (comCurriculo.length) fontes.push(`a partir dos currículos Lattes de ${juntar(comCurriculo)}`);
        if (soNome.length) fontes.push(`apenas pelo nome, sem o currículo, de ${juntar(soNome)}`);
        return `<p>Foram observados critérios éticos. A ferramenta retirou das indicações as pessoas com vínculo
            pré-existente (${vinculos}) com a autoria do trabalho ou com a orientação, verificado ${juntar(fontes)}.
            ${retirados === 1 ? 'Uma pessoa foi retirada' : `${retirados} pessoas foram retiradas`} das indicações por esse motivo.
            ${soNome.length ? 'Na verificação apenas pelo nome, as publicações da própria pessoa não puderam ser conferidas; para ela, declaro também a ausência de vínculo pré-existente com as pessoas escolhidas.' : ''}</p>`;
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
            aviso.innerHTML = '<p class="text-red-700 dark:text-red-400">Marque ao menos uma pessoa escolhida para a banca.</p>';
            return;
        }
        // Dados atuais de Minha Dissertação; o que foi usado na busca completa o que faltar.
        const atual = window.BancaZen ? window.BancaZen.dadosDissertacao() : {};
        const d = Object.fromEntries(Object.keys({ ...resultado.dissertacao, ...atual }).map((k) => [k, atual[k] || resultado.dissertacao[k] || '']));
        const considerados = resultado.conformidade.considerados || [];
        const nomeDe = (papel) => d[papel] || (considerados.find((p) => p.papel.toLowerCase().startsWith(papel)) || {}).nome || '';
        const orientador = nomeDe('orientador');
        const coorientador = nomeDe('coorientador');
        const tipo = $('#relTipoInput').value === 'qualificacao' ? 'exame de qualificação' : 'defesa';
        const programa = $('#relProgramaInput').value.trim();
        const local = $('#relLocalInput').value.trim();
        const agora = new Date();
        const marcadas = new Map(lista.map((x) => [chave(x.pessoa), x]));
        const retirados = resultado.listas.reduce((n, l) => n + (l.retirados || []).length, 0);
        const cr = resultado.criterios;
        const criterios = [
            cr.excluirInstituicao ? `desconsideradas as pessoas da instituição "${cr.excluirInstituicao}"` : '',
            cr.somenteDoutores ? 'somente pessoas com doutorado concluído' : '',
            cr.periodo ? `coautorias dos últimos ${cr.periodo} anos` : 'coautorias de todo o período',
        ].filter(Boolean);
        const faltando = [!d.nome && 'o seu nome', !d.titulo && 'o título do trabalho', !orientador && 'o nome da orientação'].filter(Boolean);
        aviso.innerHTML = [
            faltando.length ? `<p class="text-amber-800 dark:text-amber-300">Faltam ${juntar(faltando)} (em Minha Dissertação); o documento sai com espaço em branco.</p>` : '',
            !considerados.length ? '<p class="text-amber-800 dark:text-amber-300">A busca foi feita sem "Minha orientação": o relatório informa que a verificação automática de vínculos não foi realizada. Para incluí-la, preencha Minha orientação e busque de novo.</p>' : '',
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
            <h3 class="doc-titulo">Declaração de indicação de membros externos para a banca de ${tipo}</h3>
            <p>Eu, ${esc(d.nome || branco)}, discente do ${esc(programa || branco)}, responsável pelo trabalho intitulado
                "${esc(d.titulo || branco)}", sob orientação de ${esc(orientador || branco)}${coorientador ? ` e coorientação de ${esc(coorientador)}` : ''},
                declaro que a escolha dos membros externos da banca de ${tipo} seguiu um processo objetivo de
                indicação, apoiado pela ferramenta bancaZen.</p>
            <p>A ferramenta comparou o título, o resumo e as palavras-chave do trabalho com os currículos Lattes cadastrados,
                pelo modelo BM25, e calculou para cada pessoa um índice de proximidade temática de 0 a 1. As indicações foram
                apresentadas em duas listas, Rede PROFIAP e Externa, em ordem decrescente do índice. Critérios da busca:
                ${esc(criterios.join('; '))}.</p>
            ${paragrafoEtico(resultado.conformidade, retirados)}
            <h4 class="doc-subtitulo">Indicações do bancaZen</h4>
            <p class="doc-nota">Busca realizada em ${esc(dataHora(resultado.em))}. Índice de proximidade de 0 a 1.</p>
            ${resultado.listas.map((l) => tabelaIndicacoes(l, marcadas)).join('')}
            <h4 class="doc-subtitulo">Pessoas escolhidas</h4>
            <ol class="doc-escolhidas">
                ${lista.map((x) => `<li>${esc(x.pessoa.nome)}, ${esc(x.pessoa.universidade || x.pessoa.instituicao || '')}, ${esc(PAPEIS_BANCA[x.papel].toLowerCase())}
                    (lista ${esc(x.lista)}, ${x.posicao}ª indicação, índice ${fmt.format(x.score)})</li>`).join('')}
            </ol>
            <p class="doc-local">${esc(local || branco)}, ${esc(dataExtenso(agora))}.</p>
            <div class="doc-assinaturas">
                <div><span class="doc-linha-assinatura"></span>${esc(d.nome || 'Discente')}<br><small>Discente</small></div>
                <div><span class="doc-linha-assinatura"></span>${esc(orientador || 'Orientação')}<br><small>Orientação</small></div>
            </div>
            <div class="doc-rodape">
                <p>Documento gerado em ${esc(dataHora(agora))} pelo bancaZen ${esc(versao)} (${esc(enderecoSite())}).</p>
                <p><strong>Como citar o bancaZen:</strong> ${esc(autorAbnt)}. <em>bancaZen</em>: indicação de membros externos
                    para bancas de defesa de mestrado. Versão ${esc(versao.replace(/^v/, ''))}. ${agora.getFullYear()}.
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
