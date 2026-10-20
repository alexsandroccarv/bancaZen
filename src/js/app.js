/* ==========================================================================
   BuscaBanca — aplicação (aba "Indicar banca")
   --------------------------------------------------------------------------
   O navegador só envia o formulário: a comparação com os currículos e a
   verificação de vínculos rodam no servidor (api/buscar.php), que devolve
   duas listas (PROFIAP e outros programas) com até 10 pessoas sem vínculo
   cada, mais as retiradas por vínculo. Os currículos e o índice processado
   nunca chegam ao navegador.
   ========================================================================== */
(function () {
    const $ = (s) => document.querySelector(s);
    const ENVOLVIDOS = ['discente', 'orientador', 'coorientador'];

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
    function programa(p) {
        return [p.ppg, p.ppgInstituicao].filter(Boolean).join(' · ');
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
    function mostrarErro(msg) {
        const erro = $('#buscaErro');
        erro.textContent = msg;
        erro.classList.toggle('hidden', !msg);
    }

    async function buscar(ev) {
        ev.preventDefault();
        mostrarErro('');
        if (!$('#tituloInput').value.trim() && !$('#resumoInput').value.trim() && !$('#palavrasInput').value.trim()) {
            mostrarErro('Preencha ao menos o título, o resumo ou as palavras-chave.');
            $('#tituloInput').focus();
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
            if (!r.ok || dados.erro) { mostrarErro(dados.erro || `Erro ${r.status} no servidor.`); return; }
            for (const k of ENVOLVIDOS) {
                $(`#${k}Status`).textContent = dados.envolvidos && dados.envolvidos[k] ? `Currículo considerado: ${dados.envolvidos[k]}.` : '';
            }
            renderListas(dados.listas || []);
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
            p.instituicao && p.instituicao !== p.ppgInstituicao ? `Lattes: ${[p.instituicao, p.uf].filter(Boolean).join(' / ')}` : '',
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
                    ${programa(p) ? `<p class="text-sm font-medium">${esc(programa(p))}</p>` : ''}
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
                ${programa(r.pessoa) ? `<p class="text-sm">${esc(programa(r.pessoa))}</p>` : ''}
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

    function renderListas(listas) {
        const sec = $('#resultado');
        sec.classList.remove('hidden');
        $('#listas').innerHTML = listas.map((l, n) => {
            const resumo = l.resultados.length
                ? `${l.resultados.length} pessoa(s) entre ${l.total} currículo(s) deste grupo.`
                : (l.total
                    ? `Nenhum dos ${l.total} currículo(s) deste grupo tem termos em comum com o trabalho sem ter vínculo identificado.`
                    : 'Nenhum currículo cadastrado neste grupo.');
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
        carregarStatus();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
