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
confere(count($ana['bancas']) === 3 && $ana['bancas'][0]['t'] === 'Banca sobre tema qualquer de outra pessoa 0', 'títulos das bancas de mestrado');
confere(($ana['producoes'][0]['tp'] ?? '') === 'a' && $ana['versao'] === LATTES_VERSAO, 'artigos marcados; versão do extrator');
confere($ana['sexo'] === 'F' && $porId['0000000000000004']['sexo'] === 'M' && $porId['0000000000000005']['sexo'] === '', 'sexo do Lattes (F, M ou não informado)');

/* ---------------- ordem: empate na proximidade exibida ------------------- */
$r = fn($nome, $score, $sexo) => ['pessoa' => ['nome' => $nome, 'sexo' => $sexo], 'score' => $score];
$ordem = sim_ordenar([$r('Marcos', 0.124, 'M'), $r('Bia', 0.118, 'F'), $r('Rui', 0.13, 'M'), $r('Lia', 0.121, 'F'), $r('Sem', 0.122, '')],
    fn($p) => $p['sexo'] === 'F');
confere(array_map(fn($x) => $x['pessoa']['nome'], $ordem) === ['Rui', 'Lia', 'Bia', 'Marcos', 'Sem'],
    'empate em 0,12: sexo feminino primeiro (por proximidade entre elas); 0,13 continua antes');
confere(!isset(bb_publico($ana + ['programa' => ['ppg' => 'PROFIAP']])['sexo']), 'sexo nunca sai na resposta pública');

/* ---------------------------------- BM25 --------------------------------- */
// Pessoas fictícias mínimas para conferir as propriedades do BM25.
$pp = fn($id, $resumo, $extra = []) => ['id' => $id, 'nome' => "Pessoa $id", 'resumo' => $resumo] + $extra;
$focado = $pp('A', 'auditoria governamental');
$extenso = $pp('B', 'auditoria governamental ' . str_repeat('logística transporte armazenagem estoque frota ', 40));
$repete1 = $pp('C', 'controladoria municipal');
$repete8 = $pp('D', str_repeat('controladoria ', 8) . 'municipal');
$bancaSo = $pp('E', 'saúde coletiva', ['bancas' => [['t' => 'Ouvidoria pública e participação', 'a' => '2025']]]);
$neutros = array_map(fn($i) => $pp("N$i", 'logística empresarial e cadeia de suprimentos'), range(1, 6));
$ib = sim_criar_indice(array_merge([$focado, $extenso, $repete1, $repete8, $bancaSo], $neutros), 2026);
$nota = function (string $texto, string $id) use ($ib) {
    foreach (sim_buscar($ib, ['titulo' => $texto], ['limite' => INF])['resultados'] as $r) if ($r['pessoa']['id'] === $id) return $r['score'];
    return 0.0;
};
confere($nota('auditoria governamental', 'A') > $nota('auditoria governamental', 'B'), 'BM25: currículo extenso não ganha só pelo volume');
$n1 = $nota('controladoria', 'C');
$n8 = $nota('controladoria', 'D');
confere($n8 > $n1 && $n8 < 2 * $n1, 'BM25: repetir o termo rende cada vez menos (saturação)');
confere($nota('ouvidoria pública', 'E') > 0, 'títulos das bancas entram na busca');
foreach (sim_buscar($ib, ['titulo' => 'auditoria governamental controladoria ouvidoria'], ['limite' => INF])['resultados'] as $r) {
    confere($r['score'] > 0 && $r['score'] < 1, 'BM25: proximidade entre 0 e 1');
}

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
// Só o nome (sem currículo): procura o nome nas produções e orientações da pessoa indicada.
$soNome = [['papel' => 'Orientadora', 'pessoa' => ['id' => '', 'nome' => 'Olga Orientadora Prado', 'citacoes' => []]]];
confere($tipos(vinc_verificar($porId['0000000000000003'], $soNome)) === ['Orientadora:coautoria:provável'], 'só o nome da orientação: coautoria encontrada no currículo indicado');
confere($tipos(vinc_verificar($porId['0000000000000004'], [['papel' => 'Orientadora', 'pessoa' => ['id' => '', 'nome' => 'Diego Suposto Alves']]])) === ['Orientadora:mesma pessoa:confirmado'], 'só o nome: mesma pessoa pelo nome completo');
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
confere(!in_array('email', $rel['colunasDescartadas'], true) && in_array('seq', $rel['colunasDescartadas'], true), 'docentes: e-mail guardado, outras colunas descartadas');
confere($docs['0000000000000001']['email'] === 'ana@exemplo.br', 'docentes: e-mail da planilha');
confere($docs['0000000000000004']['email'] === 'diego@exemplo.br', 'docentes: duplicidade sem e-mail fica com o do outro registro');
[$docsEmail, $relEmail] = doc_ler_csv("nome;lattes_id;e-mail\nFulano;1111222233334444;invalido@\nCiclana;1111222233334445;\n", ['ppg' => 'PROFIAP']);
confere($docsEmail['1111222233334444']['email'] === '' && $docsEmail['1111222233334445']['email'] === '' && $relEmail['emailInvalido'] === 1, 'docentes: e-mail opcional; inválido ignorado e contado');
$pubDoc = bb_publico(['id' => '0000000000000001', 'nome' => 'Ana', 'programa' => ['ppg' => 'X']], $docs);
confere(!str_contains(json_encode($pubDoc), '@'), 'docentes: e-mail nunca sai na resposta pública');
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
[$juntos, $r] = doc_aplicar($antes, $docs, true);
confere(!isset($juntos['0000000000000050']) && isset($juntos['0000000000000060']) && $r['removidos'] === 1 && $r['novos'] === 3, 'docentes: substituir só o mesmo PPG');
[$juntos] = doc_aplicar($antes, $docs, false);
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

/* ---------------- docente permanente (Normas, 13.1) ----------------------- */
$pp = ['id' => '0000000000000077', 'programa' => ['ppg' => 'PROFIAP', 'instituicao' => 'X', 'situacao' => '']];
confere(!bb_permanente($pp), 'sem situação: não conta como permanente');
confere(bb_permanente($pp, ['0000000000000077' => ['ppg' => 'PROFIAP', 'universidade' => 'X', 'situacao' => 'Permanente']]), 'situação da lista de docentes: permanente');
confere(!bb_permanente($pp, ['0000000000000077' => ['ppg' => 'PROFIAP', 'universidade' => 'X', 'situacao' => 'Colaborador']]), 'colaborador não é permanente');
$pp['programa']['situacao'] = 'permanente';
confere(bb_permanente($pp), 'situação gravada com o XML, sem diferenciar maiúsculas');

/* ------- lista da banca pelo PPG (Rede PROFIAP / programa externo) -------- */
foreach (['PROFIAP', 'profiap', ' Profiap ', 'PRÓFIAP'] as $ppg) confere(bb_grupo_do_ppg($ppg) === 'profiap', "PPG \"$ppg\" -> Rede PROFIAP");
foreach (['PPG em Administração', 'PROFIAP-UFX', 'Rede', ''] as $ppg) confere(bb_grupo_do_ppg($ppg) === 'outro', "PPG \"$ppg\" -> programa externo");
confere(BB_GRUPOS === ['profiap' => 'Rede PROFIAP', 'outro' => 'Programa externo à Rede PROFIAP'], 'rótulos das listas (Normas Acadêmicas, 13.1 b e c)');
// Registros de versões anteriores, com "grupo" gravado, seguem o PPG.
$antigo = ['id' => '0000000000000002', 'nome' => 'X', 'instituicao' => 'Inst. do Lattes', 'programa' => ['grupo' => 'outro', 'ppg' => 'PROFIAP', 'instituicao' => '']];
confere(bb_grupo($antigo) === 'profiap', 'grupo gravado antes é ignorado: vale o PPG');
confere(bb_publico($antigo)['universidade'] === 'Inst. do Lattes', 'sem instituição no envio, vale a do Lattes');
$docAntigo = ['0000000000000002' => ['id' => '0000000000000002', 'nome' => 'X', 'universidade' => 'U', 'ppg' => 'PPG Y', 'grupo' => 'profiap', 'situacao' => '']];
confere(bb_grupo($antigo, $docAntigo) === 'outro', 'lista de docentes antiga com "grupo": vale o PPG da lista');

// Índice montado a partir dos XMLs copiados direto para <dados>/xml/ (rsync).
$tmpR = sys_get_temp_dir() . '/bb-reindex-' . bin2hex(random_bytes(4));
putenv("BANCAZEN_DADOS=$tmpR");
mkdir("$tmpR/xml", 0750, true);
foreach (['curriculo-1.xml' => 'a.xml', 'curriculo-2.xml' => 'b.XML', 'curriculo-3.xml' => 'c.xml', 'curriculo-5.zip' => 'd.zip'] as $de => $para) copy(__DIR__ . "/fixtures/$de", "$tmpR/xml/$para");
file_put_contents("$tmpR/xml/leia-me.txt", 'ignorado');
file_put_contents("$tmpR/xml/quebrado.xml", '<nada/>');
bb_alterar_docentes(fn($d) => [['0000000000000001' => ['id' => '0000000000000001', 'nome' => 'Ana', 'universidade' => 'Univ. da Lista', 'ppg' => 'PROFIAP', 'situacao' => 'Permanente']], null]);
$sim = bb_reindexar(null, true);
confere($sim['arquivos'] === 5 && $sim['novo'] === 4 && count($sim['semPpg']) === 3, 'reindexar simulado: quem não está na lista é guardado sem dados e listado');
confere(count($sim['erros']) === 1 && !is_file("$tmpR/corpus.json"), 'reindexar simulado: erro do arquivo inválido e nada gravado');
$r = bb_reindexar(null);
$c = bb_carregar_corpus();
confere($r['novo'] === 4 && $r['total'] === 4 && count($r['semPpg']) === 3, 'reindexar sem --ppg guarda todos');
confere(bb_tem_dados($c['0000000000000001'], bb_carregar_docentes()) && !bb_tem_dados($c['0000000000000002'], bb_carregar_docentes()), 'sem dados na lista nem --ppg: currículo fora da busca');
$r = bb_reindexar(bb_programa('PPG em Teste', 'Univ. Padrão'));
$c = bb_carregar_corpus();
confere($r['substituido'] === 8 && $r['novo'] === 0 && $r['total'] === 4 && !$r['semPpg'], 'reindexar com --ppg completa quem estava sem dados');
confere($c['0000000000000001']['programa']['ppg'] === 'PROFIAP' && $c['0000000000000002']['programa']['ppg'] === 'PPG em Teste', 'reindexar: programa da lista ou do índice prevalece sobre o --ppg');
confere(is_file("$tmpR/xml/0000000000000005.xml"), 'reindexar guarda o XML do ZIP pelo ID');
$r = bb_reindexar(bb_programa('Outro'));
confere($r['total'] === 4 && $r['novo'] === 0 && bb_carregar_corpus()['0000000000000002']['programa']['ppg'] === 'PPG em Teste', 'reindexar de novo não duplica nem troca o programa');
confere(count($r['comOutroNome']) === 4 && $r['organizados'] === 0 && is_file("$tmpR/xml/a.xml"), 'reindexar aponta as cópias com outro nome sem apagá-las');
$r = bb_reindexar(null, false, true);
$resta = array_map('basename', glob("$tmpR/xml/*"));
sort($resta);
confere($r['organizados'] === 4 && $resta === ['0000000000000001.xml', '0000000000000002.xml', '0000000000000003.xml', '0000000000000005.xml', 'leia-me.txt', 'quebrado.xml'], 'reindexar --organizar apaga só as cópias já gravadas');
confere(bb_reindexar(null)['total'] === 4, 'índice intacto depois de organizar');
// Em lotes (Administração): cursor pelo nome do arquivo.
$l1 = bb_reindexar(null, true, false, '', 2);
$l2 = bb_reindexar(null, true, false, $l1['ultimo'], 2);
$l3 = bb_reindexar(null, true, false, $l2['ultimo'], 2);
confere($l1['arquivos'] === 2 && $l1['restantes'] === 3 && $l2['arquivos'] === 2 && $l3['arquivos'] === 1 && $l3['restantes'] === 0 && $l1['totalArquivos'] === 5 && $l3['ultimo'] === 'quebrado.xml', 'reindexar em lotes percorre todos os arquivos');
confere($l1['indiceAtual'] === 4 && count($l1['pessoas']) === 2 && $l1['pessoas'][0]['situacao'] === 'substituido', 'reindexar simulado em lotes informa índice atual e pessoas');
// Registro leve no corpus.json e completo em pessoas/<id>.json.
$leves = bb_carregar_corpus();
confere(!isset(reset($leves)['producoes']) && is_file("$tmpR/pessoas/0000000000000001.json"), 'corpus.json leve; registro completo em pessoas/');
$compl = bb_carregar_pessoa($leves['0000000000000001']);
confere(!empty($compl['producoes']) && $compl['programa']['ppg'] === 'PROFIAP', 'registro completo com produções e o programa do corpus');
// Registro gravado por versão anterior do extrator: relido do XML guardado.
$velho = json_decode(file_get_contents("$tmpR/pessoas/0000000000000001.json"), true);
unset($velho['bancas']);
$velho['versao'] = 1;
file_put_contents("$tmpR/pessoas/0000000000000001.json", json_encode($velho));
$relido = bb_carregar_pessoa($leves['0000000000000001']);
confere(count($relido['bancas']) === 3 && $relido['programa']['ppg'] === 'PROFIAP', 'registro antigo relido do XML (títulos das bancas), programa mantido');
confere(json_decode(file_get_contents("$tmpR/pessoas/0000000000000001.json"), true)['versao'] === LATTES_VERSAO, 'registro relido regravado na versão atual');
// Índice em partes no disco: mesmo ranking da busca em memória.
$meta = bb_indice_garantir();
confere($meta['N'] === count($leves) && is_dir("$tmpR/indice/termos"), 'índice de busca gravado em partes');
$consultaT = ['titulo' => 'Governança pública e transparência', 'resumo' => 'controle social nos municípios', 'palavrasChave' => ['accountability']];
$docsT = [];
foreach ($meta['ids'] as $k => $id) $docsT[$k] = ['pessoa' => $leves[$id], 'comprimento' => $meta['comprimentos'][$k]];
$disco = sim_buscar_partes($consultaT, ['limite' => INF], bb_indice_leitor(), $docsT, $meta['media']);
$memoria = sim_buscar(sim_criar_indice(array_map('bb_carregar_pessoa', array_values($leves))), $consultaT, ['limite' => INF]);
$resumoR = fn($r) => array_map(fn($x) => $x['pessoa']['id'] . ':' . round($x['score'], 4) . ':' . implode(',', $x['termos']), $r['resultados']);
confere($resumoR($disco) === $resumoR($memoria) && count($disco['resultados']) > 0, 'busca no índice em partes = busca em memória (ordem, proximidade e termos)');
confere(bb_indice_garantir()['criadoEm'] === $meta['criadoEm'], 'índice não é refeito sem mudança no corpus');
$sexoIdx = array_combine($meta['ids'], $meta['sexos']);
confere($sexoIdx['0000000000000001'] === 'F' && $sexoIdx['0000000000000002'] === 'M', 'índice guarda o sexo de cada currículo, na ordem dos ids');
// Ana (F) e Elisa (não informado) empatam em 0,75: Ana primeiro.
$emp = sim_ordenar($disco['resultados'], fn($p) => ($sexoIdx[$p['id']] ?? '') === 'F');
$ids2 = array_map(fn($x) => $x['pessoa']['id'], array_slice($emp, 0, 2));
confere($ids2[0] === '0000000000000001', 'empate Ana x Elisa: a de sexo feminino primeiro');

// Zona de risco: limpar a base (a senha fica).
file_put_contents("$tmpR/admin.json", '{"hash":"x"}');
$antesLimpar = count(bb_carregar_corpus());
$lim = bb_limpar(false, true);
confere($lim['docentes'] === 1 && !bb_carregar_docentes() && count(bb_carregar_corpus()) === $antesLimpar, 'limpar só a lista de docentes');
$lim = bb_limpar(true, false);
confere($lim['curriculos'] === $antesLimpar && $lim['arquivos'] > 0 && !bb_carregar_corpus() && !glob("$tmpR/xml/*"), 'limpar currículos: índice e arquivos de xml/');
confere(is_file("$tmpR/admin.json"), 'limpar não apaga a senha');
bb_apagar_pasta($tmpR);
putenv("BANCAZEN_DADOS=$tmp");

// Cadastro só com arquivos: PPG opcional no envio; substituição pelos PPGs do arquivo.
confere(bb_programa('', '', '', false)['ppg'] === '', 'programa sem PPG aceito quando não exigido');
$antesSub = ['A' => ['id' => 'A', 'ppg' => 'PROFIAP'], 'B' => ['id' => 'B', 'ppg' => 'Outro PPG'], 'C' => ['id' => 'C', 'ppg' => 'Profiap ']];
[$depoisSub, $rSub] = doc_aplicar($antesSub, ['D' => ['id' => 'D', 'ppg' => 'PROFIAP']], true);
confere(array_keys($depoisSub) === ['B', 'D'] && $rSub['removidos'] === 2, 'substituir troca só a lista dos PPGs presentes no arquivo');
confere($rel['ppgPadrao'] > 0, 'linhas sem coluna ppg contadas (ficam com o PPG padrão)');

// Arquivos que não são currículo: a mensagem diz o que contêm.
$motivo = function (string $bytes) { try { lattes_ler_arquivo('x.xml', $bytes); return ''; } catch (RuntimeException $e) { return $e->getMessage(); } };
confere(str_contains($motivo(''), 'está vazio'), 'arquivo vazio identificado');
$html = $motivo('<!DOCTYPE html><html><head><title>Currículo não encontrado</title></head><body><p>Erro</p></body></html>');
confere(str_contains($html, 'página HTML') && str_contains($html, 'título: "Currículo não encontrado"'), 'página HTML identificada, com o título');
confere(str_contains($motivo('<?xml version="1.0"?><ERRO><MENSAGEM>Identificador inexistente</MENSAGEM></ERRO>'), 'elemento principal é <ERRO>') , 'outro XML identificado pelo elemento principal');
confere(str_contains($motivo('<?xml version="1.0"?><ERRO><MENSAGEM>Identificador inexistente</MENSAGEM></ERRO>'), 'Identificador inexistente'), 'texto do outro XML na mensagem');
// Variações do mesmo currículo aceitas: atributos xmlns, gzip e base64 (ZIP do serviço do CNPq).
$cv1 = file_get_contents("$dir/curriculo-1.xml");
$comNs = preg_replace('/<CURRICULO-VITAE /', '<CURRICULO-VITAE xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="x.xsd" ', $cv1, 1);
confere(lattes_ler_arquivo('a.xml', $comNs)[0]['pessoa']['id'] === '0000000000000001', 'CURRICULO-VITAE com xmlns:xsi');
confere(lattes_ler_arquivo('a.xml', gzencode($cv1))[0]['pessoa']['id'] === '0000000000000001', 'XML compactado com gzip');
confere(lattes_ler_arquivo('a.xml', chunk_split(base64_encode(file_get_contents("$dir/curriculo-5.zip")), 76))[0]['pessoa']['id'] === '0000000000000005', 'ZIP em base64 com extensão .xml');

// ID Lattes na planilha: número ou link, cabeçalhos variados, tabulação.
$csvIds = "Nome;ID Lattes\n"
    . "Pessoa Numero;1533188485721174\n"
    . "Pessoa Link Http;http://lattes.cnpq.br/1533188485721175\n"
    . "Pessoa Link Https;https://lattes.cnpq.br/1533188485721176/\n"
    . "Pessoa Link Www; http://www.lattes.cnpq.br/1533188485721177 \n"
    . "Pessoa Longa;15331884857211780\n"
    . "Pessoa Cientifica;1,53319E+15\n";
[$dIds, $rIds] = doc_ler_csv($csvIds, ['ppg' => 'PROFIAP']);
confere(array_map('strval', array_keys($dIds)) === ['1533188485721174', '1533188485721175', '1533188485721176', '1533188485721177'], 'ID Lattes como número ou link (http, https, www, barra final, espaços)');
confere(in_array('Pessoa Longa', $rIds['semLattes'], true) && $rIds['idCientifico'] === ['Pessoa Cientifica'], 'número com mais de 16 dígitos não é recortado; notação científica informada');
$csvDuas = "nome\tlattes_id\tLink do Lattes\n"
    . "Igual\t1533188485721174\thttp://lattes.cnpq.br/1533188485721174\n"
    . "Arredondado\t1533188485721170\thttp://lattes.cnpq.br/1533188485721179\n"
    . "So Numero\t1533188485721171\t\n"
    . "So Link\t\thttp://lattes.cnpq.br/1533188485721172\n";
[$dDuas, $rDuas] = doc_ler_csv($csvDuas, ['ppg' => 'PROFIAP']);
confere(array_map('strval', array_keys($dDuas)) === ['1533188485721174', '1533188485721179', '1533188485721171', '1533188485721172'], 'CSV com tabulação e duas colunas de Lattes: vale o link');
confere(count($rDuas['idDivergente']) === 1 && str_contains($rDuas['idDivergente'][0], 'Arredondado') && !$rDuas['colunasDescartadas'], 'divergência entre número e link informada; colunas de Lattes não descartadas');

// Base de versões anteriores (registros completos no corpus.json): convertida
// na primeira leitura, em trechos, sem carregar o arquivo inteiro.
$tmpM = sys_get_temp_dir() . '/bb-migra-' . bin2hex(random_bytes(4));
mkdir($tmpM, 0750, true);
putenv("BANCAZEN_DADOS=$tmpM");
$antigo = [];
foreach (['curriculo-1.xml', 'curriculo-2.xml'] as $f) {
    $pp = lattes_ler_arquivo($f, file_get_contents("$dir/$f"))[0]['pessoa'];
    $antigo[$pp['id']] = $pp + ['programa' => ['ppg' => 'PROFIAP', 'instituicao' => '', 'situacao' => '']];
}
// Registro maior que o trecho de leitura (1 MB), com chaves, colchetes e aspas em textos.
$antigo['0000000000000002']['resumo'] = str_repeat('texto {com} [chaves] "aspas" \\ barra ', 40000);
file_put_contents("$tmpM/corpus.json", json_encode($antigo, JSON_UNESCAPED_UNICODE));
confere(bb_corpus_legado(), 'base antiga reconhecida');
$conv = bb_carregar_corpus();
confere(!bb_corpus_legado() && count($conv) === 2 && !isset($conv['0000000000000002']['resumo']), 'base antiga convertida em corpus.json leve');
$p2 = bb_carregar_pessoa($conv['0000000000000002']);
confere($p2['resumo'] === $antigo['0000000000000002']['resumo'] && $p2['producoes'] == $antigo['0000000000000002']['producoes'], 'registro completo preservado na conversão (texto de mais de 1 MB)');
bb_apagar_pasta($tmpM);
putenv("BANCAZEN_DADOS=$tmp");

// limpeza
bb_apagar_pasta($tmp);

echo "Ranking da consulta de teste:\n";
foreach ($res as $r) printf("  %.3f  %s  [%s]\n", $r['score'], $r['pessoa']['nome'], implode(', ', $r['termos']));
if ($falhas) { fwrite(STDERR, "$falhas verificação(ões) falharam.\n"); exit(1); }
echo "OK: extrator, proximidade, vínculos, base e lista de docentes conferidos.\n";
