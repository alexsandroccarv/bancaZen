<?php
/* ==========================================================================
   bancaZen — GET api/status.php  (público)
   Só a quantidade de currículos na base; nenhum nome ou dado do índice.
   ========================================================================== */
require_once __DIR__ . '/lib/base.php';

bb_exigir_metodo('GET');
bb_json(['curriculos' => count(bb_carregar_corpus())]);
