<?php
/* ==========================================================================
   bancaZen — GET api/status.php  (público)
   Só a quantidade de currículos na busca (com dados de programa); nenhum
   nome ou dado do índice.
   ========================================================================== */
require_once __DIR__ . '/lib/base.php';

bb_exigir_metodo('GET');
$docentes = bb_carregar_docentes();
bb_json(['curriculos' => count(array_filter(bb_carregar_corpus(), fn($p) => bb_tem_dados($p, $docentes)))]);
