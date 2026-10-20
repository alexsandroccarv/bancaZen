/* ==========================================================================
   BuscaBanca — Conformidade ética: vínculos com a aluna e a orientação
   --------------------------------------------------------------------------
   Verifica se uma pessoa indicada para a banca tem vínculo com a pessoa
   discente, com a orientadora ou com a coorientadora, a partir dos
   currículos Lattes de cada uma:

     coautoria   publicação com autoria em comum, procurada nos dois sentidos
                 (a envolvida como autora nas produções da indicada e a
                 indicada nas produções da envolvida);
     orientação  uma orientou a outra (formação acadêmica de cada uma e
                 orientações concluídas ou em andamento);
     mesma pessoa  o currículo indicado é o da própria envolvida.

   Identificação das pessoas, da mais segura para a menos segura:
     1. identificador Lattes (16 dígitos)                 -> "confirmado"
     2. nome completo idêntico (sem acentos/maiúsculas)    -> "confirmado"
     3. sobrenome + iniciais (ex.: "SOUZA, A. F."), com ao
        menos duas iniciais                                -> "provável"
   O vínculo "provável" depende de conferência humana (homônimos).

   Usado no navegador (window.Vinculos) e no Node (testes).
   ========================================================================== */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.Vinculos = factory();
})(typeof self !== 'undefined' ? self : this, function () {

    const PARTICULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'del', 'della', 'di', 'du', 'van', 'von', 'y']);
    const SUFIXOS = new Set(['junior', 'jr', 'filho', 'neto', 'sobrinho', 'segundo']);

    function norm(s) {
        return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
            .toLowerCase().replace(/[^a-z0-9,\s]/g, ' ').replace(/\s+/g, ' ').trim();
    }
    function nomeCompleto(s) { return norm(s).replace(/,/g, ' ').replace(/\s+/g, ' ').trim(); }
    function idLattes(s) { const d = String(s || '').replace(/\D/g, ''); return d.length === 16 ? d : ''; }

    // "Ana Fictícia de Souza" ou "SOUZA, A. F." -> { s: 'souza', i: 'af' }
    function chave(nome) {
        const n = norm(nome);
        if (!n) return null;
        let sobrenome, prenomes;
        if (n.includes(',')) {
            const [antes, depois] = n.split(',', 2);
            const sb = antes.split(' ').filter(w => w && !PARTICULAS.has(w) && !SUFIXOS.has(w));
            sobrenome = sb[sb.length - 1];
            prenomes = depois.split(' ');
        } else {
            const partes = n.split(' ').filter(w => w && !PARTICULAS.has(w));
            while (partes.length > 1 && SUFIXOS.has(partes[partes.length - 1])) partes.pop();
            sobrenome = partes.pop();
            prenomes = partes;
        }
        const iniciais = prenomes.filter(w => w && !PARTICULAS.has(w)).map(w => w[0]).join('');
        return sobrenome && iniciais ? { s: sobrenome, i: iniciais } : null;
    }
    function chavesCombinam(a, b) {
        if (!a || !b || a.s !== b.s) return false;
        if (a.i === b.i) return a.i.length >= 2;
        const [curta, longa] = a.i.length <= b.i.length ? [a.i, b.i] : [b.i, a.i];
        return curta.length >= 2 && longa.startsWith(curta);
    }

    // Identidade de uma pessoa (currículo) para comparação.
    function identidade(p) {
        const chaves = [p.nome, ...(p.citacoes || [])].map(chave).filter(Boolean);
        return { id: idLattes(p.id), nome: nomeCompleto(p.nome), chaves };
    }
    // Compara uma referência {n: nome, c: nome em citação, id} com uma identidade.
    // Devolve 'confirmado', 'provável' ou ''.
    function casa(ref, ident) {
        const rid = idLattes(ref.id);
        if (rid && ident.id) return rid === ident.id ? 'confirmado' : '';
        if (ref.n && ident.nome && nomeCompleto(ref.n) === ident.nome) return 'confirmado';
        for (const nome of [ref.n, ...(String(ref.c || '').split(';'))]) {
            const k = chave(nome);
            if (k && ident.chaves.some(x => chavesCombinam(k, x))) return 'provável';
        }
        return '';
    }
    const melhor = (a, b) => (a === 'confirmado' || b === 'confirmado') ? 'confirmado' : (a || b);

    function producoesComAutores(p) {
        return (p.producoes || []).filter(x => x.au && x.au.length);
    }

    /* ------------------------------ verificar ----------------------------- */
    // candidato: currículo indicado. envolvidos: [{ papel, pessoa }].
    // opcoes.desdeAno: considera só coautorias a partir desse ano (orientação
    // e mesma pessoa valem sempre).
    function verificar(candidato, envolvidos, opcoes) {
        const desdeAno = (opcoes && opcoes.desdeAno) || 0;
        const identCand = identidade(candidato);
        const vinculos = [];

        for (const { papel, pessoa } of envolvidos) {
            if (!pessoa) continue;
            const identEnv = identidade(pessoa);

            // Mesma pessoa
            const mesma = (identCand.id && identCand.id === identEnv.id)
                || (identCand.nome && identCand.nome === identEnv.nome);
            if (mesma) { vinculos.push({ papel, tipo: 'mesma pessoa', certeza: 'confirmado', detalhes: [] }); continue; }

            // Coautoria nos dois sentidos, sem contar duas vezes a mesma publicação.
            const pubs = new Map();
            const registrar = (prod, certeza) => {
                const ano = parseInt(prod.a, 10) || 0;
                if (desdeAno && ano && ano < desdeAno) return;
                const k = norm(prod.t) + '|' + (prod.a || '');
                const atual = pubs.get(k);
                pubs.set(k, { t: prod.t, a: prod.a || '', certeza: melhor(atual && atual.certeza, certeza) });
            };
            for (const prod of producoesComAutores(candidato)) {
                const c = prod.au.reduce((acc, au) => melhor(acc, casa(au, identEnv)), '');
                if (c) registrar(prod, c);
            }
            for (const prod of producoesComAutores(pessoa)) {
                const c = prod.au.reduce((acc, au) => melhor(acc, casa(au, identCand)), '');
                if (c) registrar(prod, c);
            }
            if (pubs.size) {
                const lista = [...pubs.values()].sort((a, b) => (b.a || '').localeCompare(a.a || ''));
                vinculos.push({
                    papel, tipo: 'coautoria',
                    certeza: lista.some(x => x.certeza === 'confirmado') ? 'confirmado' : 'provável',
                    detalhes: lista,
                });
            }

            // Orientação, nos dois sentidos.
            const orient = [];
            let certezaOr = '';
            const quando = (o) => [o.nivel || 'formação', o.a].filter(Boolean).join(', ');
            const anotar = (c, texto, ano) => { if (c) { orient.push({ t: texto, a: ano || '' }); certezaOr = melhor(certezaOr, c); } };
            for (const o of candidato.orientadores || []) {
                anotar(casa(o, identEnv), `${o.co ? 'coorientou' : 'orientou'} a pessoa indicada (${quando(o)})`);
            }
            for (const o of pessoa.orientadores || []) {
                anotar(casa(o, identCand), `teve ${o.co ? 'coorientação' : 'orientação'} da pessoa indicada (${quando(o)})`);
            }
            for (const o of candidato.orientacoes || []) {
                if (o.o || o.oid) anotar(casa({ n: o.o, id: o.oid }, identEnv), `teve orientação da pessoa indicada: ${o.t}`, o.a);
            }
            for (const o of pessoa.orientacoes || []) {
                if (o.o || o.oid) anotar(casa({ n: o.o, id: o.oid }, identCand), `orientou a pessoa indicada: ${o.t}`, o.a);
            }
            if (orient.length) vinculos.push({ papel, tipo: 'orientação', certeza: certezaOr, detalhes: orient });
        }
        return vinculos;
    }

    return { verificar, chave, chavesCombinam, identidade, casa };
});
