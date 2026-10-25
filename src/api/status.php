<?php
/* ==========================================================================
   bancaZen — GET api/status.php  (público)
   Só a quantidade de currículos na busca (com dados de programa); nenhum
   nome ou dado do índice.
   ========================================================================== */
require_once __DIR__ . '/lib/base.php';

bb_exigir_metodo('GET');
// Contagem pré-calculada na visão da busca (lib/indice.php).
try {
    $n = bb_visao_garantir(bb_indice_garantir(true))['comDados'];
} catch (RuntimeException $e) {
    $n = 0;
}
bb_json(['curriculos' => $n]);
