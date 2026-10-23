/* ==========================================================================
   bancaZen — aplicação (seções Minha Dissertação, Minha orientação e
   Bancas sugeridas)
   --------------------------------------------------------------------------
   Os campos ficam em seções diferentes (abas) e são lidos pelo id na hora
   da busca, feita na seção Bancas sugeridas. Erros de preenchimento levam à
   seção que falta (botões data-ir, tratados em layout.js).
   O navegador só envia o formulário: a comparação com os currículos e a
   verificação de vínculos rodam no servidor (api/buscar.php), que devolve
   duas listas (Rede PROFIAP e Externa, pelo PPG) com até 10 pessoas sem vínculo
   cada, mais as retiradas por vínculo. Os currículos e o índice processado
   nunca chegam ao navegador.
   ========================================================================== */
(function () {
    const $ = (s) => document.querySelector(s);
    const ENVOLVIDOS = ['discente', 'orientador', 'coorientador'];
    const PAPEIS = {
        discente: { rotulo: 'Discente', obrigatorio: false },
        orientador: { rotulo: 'Orientador(a)', obrigatorio: false },
        coorientador: { rotulo: 'Coorientador(a)', obrigatorio: false },
    };

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
    function nomeComLink(p) {
        const url = urlLattes(p);
        return url ? `<a href="${url}" target="_blank" rel="noopener" class="hover:underline">${esc(p.nome)}</a>` : esc(p.nome);
    }
    // Ficha da pessoa: Universidade, PPG, Situação no programa e Link do
    // Lattes (o nome vem no título). Mesma ficha para as duas listas.
    function ficha(p) {
        const url = urlLattes(p);
        const campo = (rotulo, valor) => `<div class="ficha-campo"><dt>${rotulo}</dt><dd>${valor}</dd></div>`;
        return `<dl class="ficha text-sm">
            ${campo('Universidade', esc(p.universidade) || '—')}
            ${campo('PPG', esc(p.ppg) || '—')}
            ${campo('Situação no programa', esc(p.situacao) || 'não informada')}
            ${campo('Lattes', url ? `<a href="${url}" target="_blank" rel="noopener" title="${url}" class="text-brand-600 dark:text-accent-400 hover:underline whitespace-nowrap">Abrir currículo Lattes <i aria-hidden="true" class="fa-solid fa-arrow-up-right-from-square text-xs"></i><span class="sr-only"> de ${esc(p.nome)} (abre em nova aba)</span></a>` : '—')}
        </dl>`;
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
    // Erro na seção Bancas sugeridas, com botão para a seção a corrigir.
    function mostrarErro(msg, secao, rotuloSecao) {
        const erro = $('#buscaErro');
        erro.innerHTML = msg ? esc(msg) + (secao
            ? ` <button type="button" data-ir="${secao}" class="underline font-medium">Ir para ${esc(rotuloSecao)}</button>`
            : '') : '';
        erro.classList.toggle('hidden', !msg);
    }

    /* --------------------------- conferência ------------------------------ */
    // O que já foi informado nas seções 2 e 3, mostrado antes da busca.
    function situacaoEnvolvido(k) {
        const arq = $(`#${k}Arquivo`).files[0];
        if (arq) return { ok: true, texto: `arquivo ${arq.name}` };
        const id = ($(`#${k}Id`).value.match(/\d{16}/) || [])[0];
        if (id) return { ok: true, texto: `Lattes ${id}` };
        return { ok: false, texto: PAPEIS[k].obrigatorio ? 'falta informar' : 'não informado (opcional)' };
    }
    function dissertacaoPreenchida() {
        return ['#tituloInput', '#resumoInput', '#palavrasInput'].filter((id) => $(id).value.trim()).length;
    }
    // Nome e universidade da pessoa discente ficam só no navegador.
    function discente() {
        return { nome: $('#nomeInput').value.trim(), universidade: $('#universidadeInput').value.trim() };
    }
    // A universidade da pessoa discente preenche o critério "Desconsiderar
    // pessoas desta instituição", sem sobrescrever o que ela digitou lá.
    let excluirAutomatico = '';
    function sincronizarExcluir() {
        const campo = $('#excluirInput');
        const univ = $('#universidadeInput').value.trim();
        if (campo.value.trim() === '' || campo.value === excluirAutomatico) {
            campo.value = univ;
            excluirAutomatico = univ;
        }
    }

    function renderConferencia() {
        const n = dissertacaoPreenchida();
        const eu = discente();
        const item = (ok, opcional, rotulo, texto, secao) => `<li class="flex items-center gap-2">
            <i aria-hidden="true" class="fa-solid ${ok ? 'fa-circle-check text-green-700 dark:text-green-400' : (opcional ? 'fa-circle-minus text-gray-500' : 'fa-circle-xmark text-red-700 dark:text-red-400')}"></i>
            <span><span class="font-medium">${esc(rotulo)}:</span> ${esc(texto)}</span>
            <button type="button" data-ir="${secao}" class="ml-auto text-brand-600 dark:text-accent-400 hover:underline">${ok ? 'editar' : 'preencher'}</button>
        </li>`;
        $('#conferencia').innerHTML =
            item(Boolean(eu.nome && eu.universidade), true, 'Meus dados',
                [eu.nome, eu.universidade].filter(Boolean).join(' · ') || 'nome e universidade não informados', 'dissertacao') +
            item(n > 0, false, 'Minha Dissertação', n === 3 ? 'título, resumo e palavras-chave' : (n ? `${n} de 3 campos preenchidos` : 'falta preencher'), 'dissertacao') +
            ENVOLVIDOS.map((k) => {
                const s = situacaoEnvolvido(k);
                return item(s.ok, !PAPEIS[k].obrigatorio, PAPEIS[k].rotulo, s.texto, 'orientacao');
            }).join('');
    }

    async function buscar(ev) {
        ev.preventDefault();
        mostrarErro('');
        if (!dissertacaoPreenchida()) {
            mostrarErro('Preencha ao menos o título, o resumo ou as palavras-chave.', 'dissertacao', 'Minha Dissertação');
            return;
        }
        const fd = new FormData();
        fd.append('titulo', $('#tituloInput').value);
        fd.append('resumo', $('#resumoInput').value);
        fd.append('palavrasChave', $('#palavrasInput').value);
        fd.append('excluirInstituicao', $('#excluirInput').value);
        fd.append('somenteDoutores', $('#doutoresInput').checked ? '1' : '0');
        fd.append('periodo', $('#periodoInput').value);
        for (const k of ENVOLVIDOS) {
            const arq = $(`#${k}Arquivo`).files[0];
            if (arq) fd.append(`${k}Arquivo`, arq);
            fd.append(`${k}Id`, $(`#${k}Id`).value);
        }

        const btn = $('#buscarBtn');
        btn.disabled = true;
        btn.setAttribute('aria-busy', 'true');
        try {
            const r = await fetch('api/buscar.php', { method: 'POST', body: fd });
            const dados = await r.json().catch(() => ({ erro: `Erro ${r.status} no servidor.` }));
            if (!r.ok || dados.erro) {
                const msg = dados.erro || `Erro ${r.status} no servidor.`;
                // Erros sobre os currículos da orientação levam à seção 3.
                const daOrientacao = /Discente|Orientador|Coorientador|currículo Lattes/.test(msg);
                mostrarErro(msg, daOrientacao ? 'orientacao' : null, 'Minha orientação');
                return;
            }
            for (const k of ENVOLVIDOS) {
                $(`#${k}Status`).textContent = dados.envolvidos && dados.envolvidos[k] ? `Currículo considerado: ${dados.envolvidos[k]}.` : '';
            }
            renderListas(dados.listas || []);
            renderConformidade(dados.conformidade, dados.listas || []);
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
        const termos = r.termos.map((t) => `<span class="badge bg-brand-50 dark:bg-gray-700 border border-brand-100 dark:border-gray-600">${esc(t)}</span>`).join(' ');
        return `<li class="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
            <div class="flex items-start gap-3">
                <span class="font-mono text-sm font-bold text-gray-500 dark:text-gray-400 w-6 shrink-0">${i + 1}º</span>
                <div class="flex-1 min-w-0 space-y-2">
                    <div class="flex flex-wrap items-baseline justify-between gap-2">
                        <h4 class="font-semibold text-brand-600 dark:text-accent-400">${nomeComLink(p)}</h4>
                        <span class="font-mono font-bold" aria-label="Proximidade ${fmt.format(r.score)} numa escala de 0 a 1">${fmt.format(r.score)}</span>
                    </div>
                    <div class="score-bar" aria-hidden="true"><span style="width:${pct}%"></span></div>
                    ${ficha(p)}
                    <p class="text-sm text-gray-600 dark:text-gray-400">${esc(detalhes.join(' · '))}</p>
                    ${termos ? `<p class="text-sm flex flex-wrap items-center gap-1"><span class="text-gray-600 dark:text-gray-400">Termos em comum:</span> ${termos}</p>` : ''}
                </div>
            </div>
        </li>`;
    }

    function blocoRetirados(retirados) {
        if (!retirados.length) return '';
        const itens = retirados.map((r) => {
            const vs = r.vinculos.map((v) => `<li>
                <span class="badge ${v.certeza === 'confirmado' ? 'vinculo-confirmado' : 'vinculo-provavel'}">${v.certeza === 'confirmado' ? 'confirmado' : 'provável'}</span>
                ${esc(descreverVinculo(v))}</li>`).join('');
            return `<li>
                <p class="font-semibold">${nomeComLink(r.pessoa)} <span class="font-mono font-normal text-sm">(${fmt.format(r.score)})</span></p>
                ${ficha(r.pessoa)}
                <ul class="text-sm space-y-1 mt-1">${vs}</ul>
            </li>`;
        }).join('');
        return `<div class="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-gray-800 p-4 space-y-2">
            <h4 class="font-semibold flex items-center gap-2"><i aria-hidden="true" class="fa-solid fa-scale-balanced"></i> Retiradas por vínculo (conformidade ética)</h4>
            <p class="text-sm text-gray-600 dark:text-gray-400">
                Estas pessoas teriam proximidade suficiente para a lista, mas têm vínculo com a pessoa discente
                ou com a orientação. Vínculo "provável" foi identificado só pelo nome em citação e pode ser
                homônimo: confira no Lattes antes de descartar.
            </p>
            <ul class="space-y-3">${itens}</ul>
        </div>`;
    }

    // Quadro "Conformidade ética" do resultado: quem foi considerado (Minha
    // orientação é opcional) ou o aviso de que os vínculos não foram verificados.
    function renderConformidade(c, listas) {
        const caixa = $('#conformidadeResultado');
        const considerados = (c && c.considerados) || [];
        if (!considerados.length) {
            caixa.innerHTML = `<div class="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-gray-800 p-4 space-y-2">
                <h4 class="font-semibold flex items-center gap-2"><i aria-hidden="true" class="fa-solid fa-scale-balanced"></i> Conformidade ética não verificada</h4>
                <p class="text-sm">"Minha orientação" não foi preenchida: as listas podem incluir pessoas com coautoria ou relação de
                orientação com você ou com a sua orientação. Para retirá-las, informe os currículos e busque de novo.</p>
                <button type="button" data-ir="orientacao" class="text-sm text-brand-600 dark:text-accent-400 hover:underline font-medium">Preencher Minha orientação</button>
            </div>`;
            return;
        }
        const retirados = listas.reduce((n, l) => n + (l.retirados || []).length, 0);
        const pessoas = considerados.map((p) => `<li><span class="font-medium">${esc(p.papel)}:</span> ${p.id
            ? `<a href="https://lattes.cnpq.br/${esc(p.id)}" target="_blank" rel="noopener" class="text-brand-600 dark:text-accent-400 hover:underline">${esc(p.nome)}</a>`
            : esc(p.nome)}</li>`).join('');
        caixa.innerHTML = `<div class="rounded-lg border border-brand-100 dark:border-gray-700 bg-brand-50 dark:bg-gray-800 p-4 space-y-2">
            <h4 class="font-semibold flex items-center gap-2"><i aria-hidden="true" class="fa-solid fa-scale-balanced"></i> Conformidade ética verificada</h4>
            <p class="text-sm">Vínculos (coautoria, orientação ou mesma pessoa) conferidos com os currículos de:</p>
            <ul class="text-sm list-disc list-inside">${pessoas}</ul>
            <p class="text-sm">${retirados
                ? `${retirados} pessoa(s) com vínculo retirada(s) das listas; aparecem à parte, com o motivo, ao fim de cada lista.`
                : 'Nenhuma pessoa com vínculo entre as mais próximas do tema.'}</p>
        </div>`;
    }

    function renderListas(listas) {
        const sec = $('#resultado');
        sec.classList.remove('hidden');
        const eu = discente();
        $('#resultadoTitulo').textContent = eu.nome || eu.universidade
            ? `Pessoas mais próximas do tema: sugestões para ${[eu.nome, eu.universidade].filter(Boolean).join(' · ')}`
            : 'Pessoas mais próximas do tema';
        $('#listas').innerHTML = listas.map((l, n) => {
            const resumo = l.resultados.length
                ? `${l.resultados.length} pessoa(s) entre ${l.total} currículo(s) desta lista.`
                : (l.total
                    ? `Nenhum dos ${l.total} currículo(s) desta lista tem termos em comum com o trabalho sem ter vínculo identificado.`
                    : 'Nenhum currículo cadastrado nesta lista.');
            return `<section class="space-y-3" aria-labelledby="lista-${l.grupo}">
                <h3 id="lista-${l.grupo}" class="text-base font-bold">${n + 1}. ${esc(l.titulo)}</h3>
                <p class="text-sm text-gray-600 dark:text-gray-400">${esc(resumo)}</p>
                <ol class="lista-resultado list-none p-0 space-y-3">${l.resultados.map(itemResultado).join('')}</ol>
                ${blocoRetirados(l.retirados)}
            </section>`;
        }).join('');
        sec.focus();
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
        $('#universidadeInput').addEventListener('input', sincronizarExcluir);
        renderConferencia();
        carregarStatus();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
