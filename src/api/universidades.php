<?php
/* ==========================================================================
   bancaZen — GET api/universidades.php  (público)
   Nomes das universidades conhecidas pela base (planilha de docentes e
   instituições dos currículos), sem repetição e em ordem alfabética, para a
   caixa de seleção "Minha Instituição Associada". Só nomes de instituições: nenhum
   dado de pessoas.
   ========================================================================== */
require_once __DIR__ . '/lib/base.php';

bb_exigir_metodo('GET');
$docentes = bb_carregar_docentes();
$nomes = [];
$guardar = function (string $u) use (&$nomes) {
    $u = trim(preg_replace('/\s+/u', ' ', $u));
    if (strlen($u) < 3) return;
    // Mesma universidade escrita de formas diferentes: fica a com acentos.
    $chave = sim_sem_acento($u);
    $acentos = fn($s) => strlen($s) - strlen(sim_sem_acento($s));
    if (!isset($nomes[$chave]) || $acentos($u) > $acentos($nomes[$chave])) $nomes[$chave] = $u;
};
foreach ($docentes as $d) $guardar(doc_capitalizar((string) ($d['universidade'] ?? '')));
foreach (bb_carregar_corpus() as $p) {
    $guardar(doc_capitalizar((string) ($p['programa']['instituicao'] ?? '')));
    $guardar(doc_capitalizar((string) ($p['instituicao'] ?? '')));
}
ksort($nomes, SORT_STRING);
bb_json(['universidades' => array_values($nomes)]);
