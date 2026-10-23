<?php
/* ==========================================================================
   bancaZen — testes do backend (extrator, proximidade, vínculos, base)
   --------------------------------------------------------------------------
   Usa os currículos fictícios de tools/fixtures/ (XML e ZIP) e a discente e
   a orientadora de tools/fixtures/envolvidos/. A pasta de dados é criada em
   um diretório temporário e apagada no fim.
   Uso: php tools/testar.php
   ========================================================================== */
$tmp = sys_get_temp_dir() . '/bb-teste-' . bin2hex(random_bytes(4));
putenv("BANCAZEN_DADOS=$tmp");
require __DIR__ . '/../src/api/lib/base.php';

$falhas = 0;
function confere($cond, string $msg): void
{
    global $falhas;
    if (!$cond) { $falhas++; fwrite(STDERR, "FALHOU: $msg\n"); }
}
function ler_fixture(string $arq): array
{
    return lattes_ler_arquivo(basename($arq), file_get_contents($arq));
}

$dir = __DIR__ . '/fixtures';
$pessoas = [];
$brutos = [];
foreach (glob("$dir/*.{xml,zip}", GLOB_BRACE) as $f) {
    foreach (ler_fixture($f) as $it) { $pessoas[] = $it['pessoa']; $brutos[] = $it; }
}
$porId = [];
foreach ($pessoas as $p) $porId[$p['id']] = $p;

/* -------------------------------- extração ------------------------------- */
confere(count($pessoas) === 5, 'cinco currículos (quatro XML e um ZIP)');
$ana = $porId['0000000000000001'];
confere($ana['nome'] === 'Ana Fictícia Souza', 'nome com acento (ISO-8859-1)');
confere($ana['titulacao'] === 'Doutorado', 'titulação');
confere($ana['instituicao'] === 'Universidade Federal Exemplo', 'instituição');
confere($ana['bancasMestrado'] === 3, 'bancas de mestrado');
confere(count($ana['producoes']) === 3, 'produções');
confere(str_starts_with($ana['resumo'], 'Professora') && !str_contains($ana['resumo'], '<'), 'resumo sem HTML');
confere(in_array('Accountability', $ana['palavrasChave'], true), 'palavras-chave');
confere(!str_contains(json_encode($ana), 'nao@extrair.br'), 'e-mail não é extraído');
confere($porId['0000000000000005']['nome'] === 'Elisa Zipada Teste', 'leitura de ZIP');

/* ------------------------------- proximidade ----------------------------- */
$indice = sim_criar_indice($pessoas, 2026);
$consulta = [
    'titulo' => 'Transparência e controle social na governança dos municípios',
    'resumo' => 'Analisa a transparência ativa dos portais de prefeituras e o papel do controle social na accountability local.',
    'palavrasChave' => ['governança pública', 'transparência', 'accountability'],
];
$res = sim_buscar($indice, $consulta, ['limite' => 10])['resultados'];
foreach ($res as $r) confere($r['score'] >= 0 && $r['score'] <= 1, 'proximidade entre 0 e 1');
for ($i = 1; $i < count($res); $i++) confere($res[$i - 1]['score'] >= $res[$i]['score'], 'ordem decrescente');
confere(in_array($res[0]['pessoa']['id'], ['0000000000000001', '0000000000000005'], true), 'perfil de governança em primeiro');
foreach ($res as $r) if ($r['pessoa']['id'] === '0000000000000002') confere($r['score'] < $res[0]['score'] / 3, 'logística bem abaixo');
confere(count(sim_buscar($indice, $consulta, ['limite' => 2])['resultados']) === 2, 'limite');
foreach (sim_buscar($indice, $consulta, ['excluirInstituicao' => 'federal exemplo'])['resultados'] as $r) {
    confere(!str_contains($r['pessoa']['instituicao'], 'Federal Exemplo'), 'exclui a instituição');
}
foreach (sim_buscar($indice, $consulta, ['somenteDoutores' => true])['resultados'] as $r) confere($r['pessoa']['nivel'] >= 5, 'somente doutores');
confere($res[0]['termos'][0] === 'governança pública', 'termos em comum (bigrama)');

/* -------------------------------- vínculos ------------------------------- */
$aluna = ler_fixture("$dir/envolvidos/aluna.xml")[0]['pessoa'];
$orientadora = ler_fixture("$dir/envolvidos/orientadora.xml")[0]['pessoa'];
confere($orientadora['citacoes'] === ['PRADO, O. O.', 'Prado, Olga Orientadora'], 'nomes em citação');
confere(count($orientadora['producoes'][0]['au']) === 2, 'autores da produção');
confere($orientadora['orientacoes'][0]['o'] === 'Maria Discente Rocha', 'orientando');
confere($aluna['orientadores'][0]['n'] === 'Diego Suposto Alves', 'orientador da graduação');

$env = [['papel' => 'Aluna', 'pessoa' => $aluna], ['papel' => 'Orientadora', 'pessoa' => $orientadora]];
$tipos = function (array $v) { $t = array_map(fn($x) => "{$x['papel']}:{$x['tipo']}:{$x['certeza']}", $v); sort($t); return $t; };
confere($tipos(vinc_verificar($porId['0000000000000001'], $env)) === ['Orientadora:coautoria:confirmado'], 'coautoria pelo ID Lattes');
confere($tipos(vinc_verificar($porId['0000000000000005'], $env)) === [], 'ID diferente: sem vínculo');
confere($tipos(vinc_verificar($porId['0000000000000003'], $env)) === ['Orientadora:coautoria:provável'], 'coautoria pelo nome em citação');
confere($tipos(vinc_verificar($porId['0000000000000004'], $env)) === ['Aluna:orientação:confirmado'], 'orientação na graduação');
confere($tipos(vinc_verificar($porId['0000000000000002'], $env)) === ['Orientadora:coautoria:confirmado'], 'coautoria pelo nome completo');
confere($tipos(vinc_verificar($porId['0000000000000002'], $env, 2021)) === [], 'coautoria antiga fora do período');
confere($tipos(vinc_verificar($orientadora, $env)) === ['Aluna:orientação:confirmado', 'Orientadora:mesma pessoa:confirmado'], 'a própria orientadora');
confere(!vinc_chaves_combinam(vinc_chave('SILVA, J.'), vinc_chave('João Pedro Silva')), 'uma inicial só não basta');
confere(vinc_chaves_combinam(vinc_chave('SILVA, J. P.'), vinc_chave('João Pedro da Silva Junior')), 'partículas e sufixos');

/* ---------------------- base: mesmo ID e programa ------------------------ */
$prof = bb_programa('PROFIAP', 'Universidade Federal Exemplo');
confere($prof['ppg'] === 'PROFIAP', 'PPG informado');
$outro = bb_programa('PPG em Administração', 'Universidade Estadual Teste');
$erro = '';
try { bb_programa('', 'X'); } catch (RuntimeException $e) { $erro = $e->getMessage(); }
confere($erro !== '', 'PPG obrigatório');

$xmlAna = $brutos[array_search('0000000000000001', array_column($pessoas, 'id'), true)]['xml'];
$r1 = bb_alterar_corpus(function ($c) use ($ana, $xmlAna, $prof) { $r = bb_guardar_curriculo($c, $ana, $xmlAna, $prof); return [$c, $r]; });
confere(is_file("$tmp/xml/0000000000000001.xml"), 'XML guardado na pasta de dados');
$maisAntigo = ['atualizacao' => '2020-01-01', 'nome' => 'Ana Antiga'] + $ana;
$r2 = bb_alterar_corpus(function ($c) use ($maisAntigo, $outro) { $r = bb_guardar_curriculo($c, $maisAntigo, '<x/>', $outro); return [$c, $r]; });
confere($r2['situacao'] === 'mantido', 'mesmo ID mais antigo: mantém o existente');
confere(bb_carregar_corpus()['0000000000000001']['nome'] === 'Ana Fictícia Souza', 'registro existente preservado');
confere(file_get_contents("$tmp/xml/0000000000000001.xml") === $xmlAna, 'XML existente preservado');
$maisNovo = ['atualizacao' => '2026-10-01', 'nome' => 'Ana Atualizada'] + $ana;
$r3 = bb_alterar_corpus(function ($c) use ($maisNovo, $outro) { $r = bb_guardar_curriculo($c, $maisNovo, '<novo/>', $outro); return [$c, $r]; });
confere($r3['situacao'] === 'substituido', 'mesmo ID mais recente: substitui');
$c = bb_carregar_corpus();
confere($c['0000000000000001']['nome'] === 'Ana Atualizada' && bb_grupo($c['0000000000000001']) === 'outro', 'registro e programa atualizados');
confere(!isset(bb_publico($c['0000000000000001'])['producoes']), 'saída pública sem produções');
confere(bb_publico($c['0000000000000001'])['ppg'] === 'PPG em Administração', 'saída pública com PPG');

/* --------------------------- lista de docentes -------------------------- */
[$docs, $rel] = doc_ler_csv(file_get_contents("$dir/docentes.csv"), ['ppg' => 'PROFIAP']);
confere($rel['linhas'] === 5 && $rel['importados'] === 3, 'docentes: 5 linhas, 3 pessoas');
confere($rel['duplicados'] === 1, 'docentes: duplicidade pelo ID Lattes');
confere($rel['semLattes'] === ['Sem Lattes Nenhum'], 'docentes: linha sem Lattes informada');
confere(in_array('email', $rel['colunasDescartadas'], true), 'docentes: coluna de e-mail descartada');
confere(!str_contains(json_encode($docs), '@'), 'docentes: nenhum e-mail guardado');
confere($docs['0000000000000001']['nome'] === 'Ana Fictícia Souza', 'docentes: nome em caixa alta convertido');
confere($docs['0000000000000001']['universidade'] === 'Universidade Federal Exemplo', 'docentes: universidade convertida');
confere($docs['0000000000000099']['universidade'] === 'Universidade Federal da Fronteira-Sul', 'docentes: hífen e partículas');
confere($docs['0000000000000004']['situacao'] === 'Permanente', 'docentes: duplicidade fica com Permanente');
confere($docs['0000000000000099']['situacao'] === 'Visitante', 'docentes: situação Visitante');

// O modelo oferecido na Administração é lido pelo próprio importador; as
// linhas de exemplo são ignoradas.
$modelo = doc_modelo_csv();
confere(str_starts_with($modelo, "\xEF\xBB\xBF") && str_contains($modelo, 'nome;lattes_id;universidade;categoria;ppg'), 'modelo: BOM e cabeçalho');
[$doModelo, $relModelo] = doc_ler_csv($modelo, ['ppg' => 'PROFIAP']);
confere($doModelo === [] && $relModelo['exemplos'] === 2 && $relModelo['linhas'] === 2 && $relModelo['colunasDescartadas'] === [], 'modelo: colunas reconhecidas e exemplos ignorados');
$preenchido = str_replace('Maria Exemplo da Silva;0000000000000000', 'Maria Exemplo da Silva;0000000000000077', $modelo);
[$umDoModelo] = doc_ler_csv($preenchido, ['ppg' => 'Outro']);
confere(isset($umDoModelo['0000000000000077']) && $umDoModelo['0000000000000077']['ppg'] === 'PROFIAP' && $umDoModelo['0000000000000077']['situacao'] === 'Permanente', 'modelo preenchido: coluna ppg prevalece sobre o formulário');

// Substituir a lista do mesmo PPG retira quem não está no arquivo novo; outro PPG fica.
$antes = ['0000000000000050' => ['id' => '0000000000000050', 'ppg' => 'PROFIAP'], '0000000000000060' => ['id' => '0000000000000060', 'ppg' => 'PPG X']];
[$juntos, $r] = doc_aplicar($antes, $docs, 'PROFIAP', true);
confere(!isset($juntos['0000000000000050']) && isset($juntos['0000000000000060']) && $r['removidos'] === 1 && $r['novos'] === 3, 'docentes: substituir só o mesmo PPG');
[$juntos] = doc_aplicar($antes, $docs, 'PROFIAP', false);
confere(isset($juntos['0000000000000050']), 'docentes: sem substituir, mantém os anteriores');

// Mesma regra para os dois grupos: a lista prevalece sobre o informado no envio.
$diego = $porId['0000000000000004'] + ['programa' => bb_programa('PPG Qualquer', 'Outra Universidade', 'Colaborador')];
$pubDiego = bb_publico($diego, $docs);
confere(bb_grupo($diego, $docs) === 'profiap' && $pubDiego['ppg'] === 'PROFIAP', 'programa efetivo: lista de docentes prevalece');
confere($pubDiego['universidade'] === 'Universidade Estadual Teste' && $pubDiego['situacao'] === 'Permanente', 'programa efetivo: universidade e situação da lista');
$semLista = bb_publico($diego, []);
confere($semLista['ppg'] === 'PPG Qualquer' && $semLista['situacao'] === 'Colaborador' && bb_grupo($diego) === 'outro', 'programa efetivo: sem a lista, vale o envio');
$erro = '';
try { bb_programa('PPG', 'Inst', 'Diretor'); } catch (RuntimeException $e) { $erro = $e->getMessage(); }
confere($erro !== '', 'situação inválida recusada');

/* ---------------- lista da banca pelo PPG (Rede PROFIAP / Externa) -------- */
foreach (['PROFIAP', 'profiap', ' Profiap ', 'PRÓFIAP'] as $ppg) confere(bb_grupo_do_ppg($ppg) === 'profiap', "PPG \"$ppg\" -> Rede PROFIAP");
foreach (['PPG em Administração', 'PROFIAP-UFX', 'Rede', ''] as $ppg) confere(bb_grupo_do_ppg($ppg) === 'outro', "PPG \"$ppg\" -> Externa");
confere(BB_GRUPOS === ['profiap' => 'Rede PROFIAP', 'outro' => 'Externa'], 'rótulos das listas');
// Registros de versões anteriores, com "grupo" gravado, seguem o PPG.
$antigo = ['id' => '0000000000000002', 'nome' => 'X', 'instituicao' => 'Inst. do Lattes', 'programa' => ['grupo' => 'outro', 'ppg' => 'PROFIAP', 'instituicao' => '']];
confere(bb_grupo($antigo) === 'profiap', 'grupo gravado antes é ignorado: vale o PPG');
confere(bb_publico($antigo)['universidade'] === 'Inst. do Lattes', 'sem instituição no envio, vale a do Lattes');
$docAntigo = ['0000000000000002' => ['id' => '0000000000000002', 'nome' => 'X', 'universidade' => 'U', 'ppg' => 'PPG Y', 'grupo' => 'profiap', 'situacao' => '']];
confere(bb_grupo($antigo, $docAntigo) === 'outro', 'lista de docentes antiga com "grupo": vale o PPG da lista');

// limpeza
array_map('unlink', glob("$tmp/xml/*"));
rmdir("$tmp/xml");
array_map('unlink', array_filter(glob("$tmp/{,.}*", GLOB_BRACE) ?: [], 'is_file'));
@rmdir($tmp);

echo "Ranking da consulta de teste:\n";
foreach ($res as $r) printf("  %.3f  %s  [%s]\n", $r['score'], $r['pessoa']['nome'], implode(', ', $r['termos']));
if ($falhas) { fwrite(STDERR, "$falhas verificação(ões) falharam.\n"); exit(1); }
echo "OK: extrator, proximidade, vínculos, base e lista de docentes conferidos.\n";
