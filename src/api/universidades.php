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
// Lista pré-calculada na visão da busca (lib/indice.php), a partir da lista
// de docentes e dos currículos.
try {
    $nomes = bb_visao_garantir(bb_indice_garantir(true))['universidades'];
} catch (RuntimeException $e) {
    $nomes = [];
}
bb_json(['universidades' => $nomes]);
