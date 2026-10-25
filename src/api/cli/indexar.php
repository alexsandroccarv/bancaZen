<?php
/* ==========================================================================
   bancaZen — monta o índice de busca e a visão (só linha de comando)
   --------------------------------------------------------------------------
   Para bases grandes (corpus.json acima de BB_INDICE_WEB_MAX), a busca não
   refaz o índice sozinha: rode este comando depois de cada carga, ou no
   cron (só refaz o que mudou). No servidor, na pasta do site:
       php api/cli/indexar.php            (refaz se o corpus ou a lista mudaram)
       php api/cli/indexar.php --forcar   (refaz tudo)
   (Se a pasta de dados não for a padrão, defina BANCAZEN_DADOS antes.)
   ========================================================================== */
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
require_once __DIR__ . '/../lib/base.php';

$op = getopt('', ['forcar', 'silencioso', 'ajuda']);
if (isset($op['ajuda'])) {
    fwrite(STDOUT, "Uso: php api/cli/indexar.php [--forcar] [--silencioso]\n");
    exit(0);
}
@ini_set('memory_limit', '1024M');
$inicio = microtime(true);
$avisar = isset($op['silencioso']) ? null : function (string $msg) use ($inicio) {
    fwrite(STDOUT, sprintf("[%6.1f s] %s\n", microtime(true) - $inicio, $msg));
};
try {
    if ($avisar) $avisar('pasta de dados: ' . bb_dir_dados());
    $indice = bb_indice_garantir(false, isset($op['forcar']), $avisar);
    $visao = bb_visao_garantir($indice, isset($op['forcar']), $avisar);
} catch (Throwable $e) {
    fwrite(STDERR, 'Erro: ' . $e->getMessage() . "\n");
    exit(1);
}
if ($avisar) {
    $avisar("índice: {$indice['N']} currículos ({$indice['criadoEm']}); com dados de programa: {$visao['comDados']}");
    $avisar(sprintf('memória máxima usada: %.1f MB', memory_get_peak_usage(true) / 1048576));
}
exit(0);
