<?php
/* ==========================================================================
   bancaZen — Conformidade ética: vínculos com a discente e a orientação
   --------------------------------------------------------------------------
   Verifica se uma pessoa indicada para a banca tem vínculo com a pessoa
   discente, com o(a) orientador(a) ou com o(a) coorientador(a), a partir
   dos currículos Lattes de cada uma:

     coautoria     publicação com autoria em comum, procurada nos dois
                   sentidos (a envolvida como autora nas produções da
                   indicada e a indicada nas produções da envolvida);
     orientação    uma orientou a outra (formação acadêmica de cada uma e
                   orientações concluídas ou em andamento);
     mesma pessoa  o currículo indicado é o da própria envolvida.

   Identificação das pessoas, da mais segura para a menos segura:
     1. identificador Lattes (16 dígitos)                 -> "confirmado"
     2. nome completo idêntico (sem acentos/maiúsculas)    -> "confirmado"
     3. sobrenome + iniciais (ex.: "SOUZA, A. F."), com ao
        menos duas iniciais                                -> "provável"
   O vínculo "provável" depende de conferência humana (homônimos).
   ========================================================================== */

const VINC_PARTICULAS = ['de', 'da', 'do', 'das', 'dos', 'e', 'del', 'della', 'di', 'du', 'van', 'von', 'y'];
const VINC_SUFIXOS = ['junior', 'jr', 'filho', 'neto', 'sobrinho', 'segundo'];

function vinc_norm(?string $s): string
{
    $s = sim_sem_acento((string) $s);
    return trim(preg_replace('/\s+/', ' ', preg_replace('/[^a-z0-9,\s]/', ' ', $s)));
}
function vinc_nome_completo(?string $s): string
{
    return trim(preg_replace('/\s+/', ' ', str_replace(',', ' ', vinc_norm($s))));
}
function vinc_id_lattes($s): string
{
    $d = preg_replace('/\D/', '', (string) $s);
    return strlen($d) === 16 ? $d : '';
}

// "Ana Fictícia de Souza" ou "SOUZA, A. F." -> ['s' => 'souza', 'i' => 'af']
function vinc_chave(?string $nome): ?array
{
    $n = vinc_norm($nome);
    if ($n === '') return null;
    $palavras = fn($s) => array_values(array_filter(explode(' ', trim($s)), fn($w) => $w !== '' && !in_array($w, VINC_PARTICULAS, true)));
    if (str_contains($n, ',')) {
        [$antes, $depois] = explode(',', $n, 2);
        $sb = array_values(array_filter($palavras($antes), fn($w) => !in_array($w, VINC_SUFIXOS, true)));
        $sobrenome = $sb ? $sb[count($sb) - 1] : '';
        $prenomes = $palavras(str_replace(',', ' ', $depois));
    } else {
        $partes = $palavras($n);
        while (count($partes) > 1 && in_array($partes[count($partes) - 1], VINC_SUFIXOS, true)) array_pop($partes);
        $sobrenome = (string) array_pop($partes);
        $prenomes = $partes;
    }
    $iniciais = implode('', array_map(fn($w) => $w[0], $prenomes));
    return $sobrenome !== '' && $iniciais !== '' ? ['s' => $sobrenome, 'i' => $iniciais] : null;
}
function vinc_chaves_combinam(?array $a, ?array $b): bool
{
    if (!$a || !$b || $a['s'] !== $b['s']) return false;
    if ($a['i'] === $b['i']) return strlen($a['i']) >= 2;
    [$curta, $longa] = strlen($a['i']) <= strlen($b['i']) ? [$a['i'], $b['i']] : [$b['i'], $a['i']];
    return strlen($curta) >= 2 && str_starts_with($longa, $curta);
}

// Identidade de uma pessoa (currículo) para comparação.
function vinc_identidade(array $p): array
{
    $chaves = array_values(array_filter(array_map('vinc_chave', array_merge([$p['nome'] ?? ''], $p['citacoes'] ?? []))));
    return ['id' => vinc_id_lattes($p['id'] ?? ''), 'nome' => vinc_nome_completo($p['nome'] ?? ''), 'chaves' => $chaves];
}
// Compara uma referência ['n' => nome, 'c' => nome em citação, 'id'] com uma
// identidade. Devolve 'confirmado', 'provável' ou ''.
function vinc_casa(array $ref, array $ident): string
{
    $rid = vinc_id_lattes($ref['id'] ?? '');
    if ($rid !== '' && $ident['id'] !== '') return $rid === $ident['id'] ? 'confirmado' : '';
    if (!empty($ref['n']) && $ident['nome'] !== '' && vinc_nome_completo($ref['n']) === $ident['nome']) return 'confirmado';
    foreach (array_merge([$ref['n'] ?? ''], explode(';', $ref['c'] ?? '')) as $nome) {
        $k = vinc_chave($nome);
        if ($k) foreach ($ident['chaves'] as $x) if (vinc_chaves_combinam($k, $x)) return 'provável';
    }
    return '';
}
function vinc_melhor(string $a, string $b): string
{
    return ($a === 'confirmado' || $b === 'confirmado') ? 'confirmado' : ($a ?: $b);
}

/* -------------------------------- verificar ------------------------------ */
// $candidato: currículo indicado. $envolvidos: [['papel' => ..., 'pessoa' => ...]].
// $desdeAno: considera só coautorias a partir desse ano (orientação e mesma
// pessoa valem sempre).
function vinc_verificar(array $candidato, array $envolvidos, int $desdeAno = 0): array
{
    $identCand = vinc_identidade($candidato);
    $vinculos = [];

    foreach ($envolvidos as $env) {
        $papel = $env['papel'];
        $pessoa = $env['pessoa'] ?? null;
        if (!$pessoa) continue;
        $identEnv = vinc_identidade($pessoa);

        // Mesma pessoa
        if (($identCand['id'] !== '' && $identCand['id'] === $identEnv['id'])
            || ($identCand['nome'] !== '' && $identCand['nome'] === $identEnv['nome'])) {
            $vinculos[] = ['papel' => $papel, 'tipo' => 'mesma pessoa', 'certeza' => 'confirmado', 'detalhes' => []];
            continue;
        }

        // Coautoria nos dois sentidos, sem contar duas vezes a mesma publicação.
        $pubs = [];
        $registrar = function (array $prod, string $certeza) use (&$pubs, $desdeAno) {
            $ano = (int) ($prod['a'] ?? 0);
            if ($desdeAno && $ano && $ano < $desdeAno) return;
            $k = vinc_norm($prod['t']) . '|' . ($prod['a'] ?? '');
            $pubs[$k] = ['t' => $prod['t'], 'a' => $prod['a'] ?? '', 'certeza' => vinc_melhor($pubs[$k]['certeza'] ?? '', $certeza)];
        };
        $lados = [[$candidato, $identEnv], [$pessoa, $identCand]];
        foreach ($lados as [$dono, $alvo]) {
            foreach ($dono['producoes'] ?? [] as $prod) {
                $c = '';
                foreach ($prod['au'] ?? [] as $au) $c = vinc_melhor($c, vinc_casa($au, $alvo));
                if ($c !== '') $registrar($prod, $c);
            }
        }
        if ($pubs) {
            $lista = array_values($pubs);
            usort($lista, fn($a, $b) => strcmp((string) $b['a'], (string) $a['a']));
            $confirmado = (bool) array_filter($lista, fn($x) => $x['certeza'] === 'confirmado');
            $vinculos[] = ['papel' => $papel, 'tipo' => 'coautoria', 'certeza' => $confirmado ? 'confirmado' : 'provável', 'detalhes' => $lista];
        }

        // Orientação, nos dois sentidos.
        $orient = [];
        $certezaOr = '';
        $anotar = function (string $c, string $texto, string $ano = '') use (&$orient, &$certezaOr) {
            if ($c === '') return;
            $orient[] = ['t' => $texto, 'a' => $ano];
            $certezaOr = vinc_melhor($certezaOr, $c);
        };
        $quando = fn($o) => implode(', ', array_filter([$o['nivel'] ?? 'formação', $o['a'] ?? '']));
        foreach ($candidato['orientadores'] ?? [] as $o) {
            $anotar(vinc_casa($o, $identEnv), (empty($o['co']) ? 'orientou' : 'coorientou') . ' a pessoa indicada (' . $quando($o) . ')');
        }
        foreach ($pessoa['orientadores'] ?? [] as $o) {
            $anotar(vinc_casa($o, $identCand), 'teve ' . (empty($o['co']) ? 'orientação' : 'coorientação') . ' da pessoa indicada (' . $quando($o) . ')');
        }
        foreach ($candidato['orientacoes'] ?? [] as $o) {
            if (!empty($o['o']) || !empty($o['oid'])) {
                $anotar(vinc_casa(['n' => $o['o'] ?? '', 'id' => $o['oid'] ?? ''], $identEnv), "teve orientação da pessoa indicada: {$o['t']}", (string) ($o['a'] ?? ''));
            }
        }
        foreach ($pessoa['orientacoes'] ?? [] as $o) {
            if (!empty($o['o']) || !empty($o['oid'])) {
                $anotar(vinc_casa(['n' => $o['o'] ?? '', 'id' => $o['oid'] ?? ''], $identCand), "orientou a pessoa indicada: {$o['t']}", (string) ($o['a'] ?? ''));
            }
        }
        if ($orient) $vinculos[] = ['papel' => $papel, 'tipo' => 'orientação', 'certeza' => $certezaOr, 'detalhes' => $orient];
    }
    return $vinculos;
}
