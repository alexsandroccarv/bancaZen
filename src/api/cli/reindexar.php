<?php
/* ==========================================================================
   bancaZen — monta o índice a partir dos XMLs já guardados (só linha de comando)
   --------------------------------------------------------------------------
   Para currículos copiados direto para <dados>/xml/ (rsync, FTP), sem passar
   pela Administração. No servidor, na pasta do site:
       php api/cli/reindexar.php --simular            (mostra, sem gravar)
       php api/cli/reindexar.php --ppg=PROFIAP        (grava)
   Opções: --ppg, --instituicao, --situacao (Permanente, Colaborador ou
   Visitante) valem para quem não está no índice nem na lista de docentes;
   sem --ppg, essas pessoas ficam de fora e são listadas. Mesmo ID Lattes:
   fica o de DATA-ATUALIZACAO mais recente. Cada currículo é gravado como
   <ID>.xml; --organizar apaga depois os arquivos originais com outro nome
   (cópias, já gravadas). Pode ser repetido sem prejuízo.
   (Se a pasta de dados não for a padrão, defina BANCAZEN_DADOS antes.)
   ========================================================================== */
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
require_once __DIR__ . '/../lib/base.php';

$op = getopt('', ['ppg:', 'instituicao:', 'situacao:', 'simular', 'organizar', 'ajuda']);
if (isset($op['ajuda'])) {
    fwrite(STDOUT, "Uso: php api/cli/reindexar.php [--simular] [--organizar] [--ppg=PPG] [--instituicao=INST] [--situacao=Permanente|Colaborador|Visitante]\n");
    exit(0);
}
$simular = isset($op['simular']);
try {
    $padrao = isset($op['ppg']) ? bb_programa((string) $op['ppg'], (string) ($op['instituicao'] ?? ''), (string) ($op['situacao'] ?? '')) : null;
} catch (Throwable $e) {
    fwrite(STDERR, 'Opção inválida: ' . $e->getMessage() . ".\n");
    exit(1);
}
@ini_set('memory_limit', '1024M');

fwrite(STDOUT, 'Pasta de dados: ' . bb_dir_dados() . ($simular ? "  (simulação: nada será gravado)\n" : "\n"));
$rel = bb_reindexar($padrao, $simular, isset($op['organizar']));

fwrite(STDOUT, "Arquivos lidos: {$rel['arquivos']}\n");
fwrite(STDOUT, "  novos no índice: {$rel['novo']}\n");
fwrite(STDOUT, "  já no índice ou repetidos (regravados): {$rel['substituido']}\n");
fwrite(STDOUT, "  mantidos (havia versão mais recente): {$rel['mantido']}\n");
if ($rel['semPpg']) {
    fwrite(STDOUT, '  sem PPG (fora do índice): ' . count($rel['semPpg']) . "\n");
    foreach (array_slice($rel['semPpg'], 0, 30) as $s) fwrite(STDOUT, "    {$s['nome']} ({$s['id']}) {$s['arquivo']}\n");
    if (count($rel['semPpg']) > 30) fwrite(STDOUT, '    … e mais ' . (count($rel['semPpg']) - 30) . "\n");
    fwrite(STDOUT, "  Para incluí-las, rode de novo com --ppg=<PPG> (ou importe a lista de docentes do programa).\n");
}
if ($rel['organizados']) {
    fwrite(STDOUT, "  cópias com outro nome apagadas (--organizar): {$rel['organizados']}\n");
} elseif ($rel['comOutroNome']) {
    fwrite(STDOUT, '  arquivos com outro nome, já gravados como <ID>.xml: ' . count($rel['comOutroNome']) . " (para apagar essas cópias, rode de novo com --organizar)\n");
}
foreach ($rel['erros'] as $e) fwrite(STDERR, "  erro: $e\n");
fwrite(STDOUT, ($simular ? 'Currículos no índice após a gravação: ' : 'Currículos no índice: ') . "{$rel['total']}\n");
exit($rel['erros'] ? 1 : 0);
