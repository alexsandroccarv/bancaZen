<?php
/* ==========================================================================
   bancaZen — POST api/buscar.php  (público)
   --------------------------------------------------------------------------
   Recebe (multipart/form-data):
     titulo, resumo, palavrasChave (texto separado por ; , ou quebra de linha)
     excluirInstituicao, somenteDoutores (1/0), periodo (0, 5 ou 10 anos)
     para cada envolvida (discente, orientador, coorientador), todas opcionais
     (sem nenhuma, a conformidade ética não é verificada e o resultado avisa):
       <papel>Arquivo  XML/ZIP do Lattes  -> lido em memória, NÃO é gravado
       <papel>Id       link ou ID Lattes de currículo que já está na base
   Devolve duas listas (Rede PROFIAP e Externa, pelo PPG), cada uma com as 10
   pessoas mais próximas SEM vínculo e as retiradas por vínculo, só com os
   campos de exibição (bb_publico), e 'conformidade' (verificada ou não, e
   quem foi considerado: papel, nome e ID Lattes). O índice completo e os XML
   nunca saem do servidor.
   ========================================================================== */
require_once __DIR__ . '/lib/base.php';

const LIMITE = 10;
const ENVOLVIDOS = [
    ['chave' => 'discente', 'papel' => 'Discente'],
    ['chave' => 'orientador', 'papel' => 'Orientador(a)'],
    ['chave' => 'coorientador', 'papel' => 'Coorientador(a)'],
];

bb_exigir_metodo('POST');
$docentes = bb_carregar_docentes();
// Currículo sem dados (fora da lista de docentes e sem PPG no envio) fica
// fora da busca até a lista trazer a pessoa.
$corpus = array_filter(bb_carregar_corpus(), fn($p) => bb_tem_dados($p, $docentes));
if (!$corpus) bb_erro('Nenhum currículo cadastrado ainda. Procure a administração do programa.', 503);

$texto = fn($k) => trim((string) ($_POST[$k] ?? ''));
$consulta = [
    'titulo' => $texto('titulo'),
    'resumo' => $texto('resumo'),
    'palavrasChave' => array_values(array_filter(array_map('trim', preg_split('/[;,\n]/', $texto('palavrasChave'))))),
];
if ($consulta['titulo'] === '' && $consulta['resumo'] === '' && !$consulta['palavrasChave']) {
    bb_erro('Preencha ao menos o título, o resumo ou as palavras-chave.');
}

// Currículos da discente e da orientação (opcionais): arquivo enviado tem
// prioridade; senão, procura o link/ID na base.
$envolvidos = [];
$avisos = [];
$considerados = [];
foreach (ENVOLVIDOS as $env) {
    $pessoa = null;
    $arq = $_FILES[$env['chave'] . 'Arquivo'] ?? null;
    if ($arq && ($arq['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_OK) {
        try {
            $pessoa = lattes_ler_arquivo($arq['name'], (string) file_get_contents($arq['tmp_name']))[0]['pessoa'];
        } catch (Throwable $e) {
            bb_erro("{$env['papel']}: não foi possível ler {$arq['name']} ({$e->getMessage()}).");
        }
    } elseif (($id = vinc_id_lattes(preg_match('/\d{16}/', $texto($env['chave'] . 'Id'), $m) ? $m[0] : '')) !== '') {
        $pessoa = $corpus[$id] ?? null;
        if (!$pessoa) bb_erro("{$env['papel']}: currículo não encontrado na base. Envie o arquivo XML ou ZIP do Lattes.");
    } elseif ($texto($env['chave'] . 'Id') !== '') {
        bb_erro("{$env['papel']}: informe um link ou ID Lattes válido (16 dígitos).");
    }
    if ($pessoa) {
        $envolvidos[] = ['papel' => $env['papel'], 'pessoa' => $pessoa];
        $avisos[$env['chave']] = $pessoa['nome'];
        $considerados[] = ['papel' => $env['papel'], 'nome' => $pessoa['nome'], 'id' => vinc_id_lattes($pessoa['id'] ?? '')];
    }
}

// Um só índice para toda a base (o IDF considera todos os currículos), e o
// ranking é separado por grupo depois.
$indice = sim_criar_indice(array_values($corpus));
$busca = sim_buscar($indice, $consulta, [
    'limite' => INF,
    'excluirInstituicao' => $texto('excluirInstituicao'),
    'somenteDoutores' => $texto('somenteDoutores') === '1',
]);
// O filtro de instituição também vale para a instituição do programa.
$excluir = trim(sim_sem_acento($texto('excluirInstituicao')));

$periodo = (int) $texto('periodo');
$desdeAno = in_array($periodo, [5, 10], true) ? (int) date('Y') - $periodo + 1 : 0;
$listas = [];
foreach (BB_GRUPOS as $grupo => $titulo) {
    $listas[$grupo] = ['grupo' => $grupo, 'titulo' => $titulo, 'resultados' => [], 'retirados' => [],
        'total' => count(array_filter($corpus, fn($p) => bb_grupo($p, $docentes) === $grupo))];
}
// Percorre o ranking completo: quem tem vínculo sai da lista do seu grupo (e
// é exibido à parte) até cada lista ter 10 pessoas sem vínculo.
foreach ($busca['resultados'] as $r) {
    $p = $r['pessoa'];
    if ($excluir !== '' && str_contains(sim_sem_acento(bb_programa_efetivo($p, $docentes)['instituicao']), $excluir)) continue;
    $l = &$listas[bb_grupo($p, $docentes)];
    if (count($l['resultados']) < LIMITE) {
        $item = ['pessoa' => bb_publico($p, $docentes), 'score' => round($r['score'], 4), 'termos' => $r['termos']];
        $vinculos = vinc_verificar($p, $envolvidos, $desdeAno);
        if ($vinculos) $l['retirados'][] = $item + ['vinculos' => $vinculos];
        else $l['resultados'][] = $item;
    }
    unset($l);
}

bb_json([
    'listas' => array_values($listas),
    'envolvidos' => $avisos,
    'conformidade' => ['verificada' => (bool) $envolvidos, 'considerados' => $considerados],
]);
