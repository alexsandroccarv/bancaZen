<?php
/* ==========================================================================
   bancaZen — POST api/buscar.php  (público)
   --------------------------------------------------------------------------
   Recebe (multipart/form-data):
     titulo, resumo, palavrasChave (texto separado por ; , ou quebra de linha)
     excluirInstituicao, somenteDoutores (1/0), somentePermanentes (1/0; sem o
     campo, 0), periodo (0, 5 ou 10 anos)
     para cada envolvida (discente, orientador, coorientador), todas opcionais
     (sem nenhuma, a conformidade ética não é verificada e o resultado avisa):
       <papel>Arquivo  XML/ZIP do Lattes  -> lido em memória, NÃO é gravado
       <papel>Id       link ou ID Lattes de currículo que já está na base
       <papel>Nome     nome; sem currículo, a verificação é só pelo nome
                       (coautorias e orientações nos currículos indicados)
   Devolve duas listas (Rede PROFIAP e Programa externo à Rede PROFIAP, pelo PPG), cada uma com as 10
   pessoas mais próximas SEM vínculo e as retiradas por vínculo, só com os
   campos de exibição (bb_publico), e 'conformidade' (verificada ou não, e
   quem foi considerado: papel, nome e ID Lattes). O índice completo e os XML
   nunca saem do servidor.
   ========================================================================== */
require_once __DIR__ . '/lib/base.php';

const LIMITE = 10;
const ENVOLVIDOS = [
    ['chave' => 'discente', 'papel' => 'Discente'],
    ['chave' => 'orientador', 'papel' => 'Orientação'],
    ['chave' => 'coorientador', 'papel' => 'Coorientação'],
];

bb_exigir_metodo('POST');
// Base pequena: o índice é refeito aqui depois de uma carga (alguns
// segundos). Base grande: vale o índice da última indexação (Administração
// ou api/cli/indexar.php). A busca lê só os termos da consulta (lib/indice.php):
// nem o corpus nem a lista de docentes são carregados inteiros.
@set_time_limit(600);
try {
    $indice = bb_indice_garantir(true);
    $visao = bb_visao_garantir($indice);
} catch (RuntimeException $e) {
    bb_erro($e->getMessage(), 503);
}
// Currículo sem dados (fora da lista de docentes e sem PPG no envio) fica
// fora da busca até a lista trazer a pessoa.
if (!$visao['comDados']) bb_erro('Nenhum currículo cadastrado ainda. Procure a administração do programa.', 503);

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
        // Qualquer currículo guardado serve, mesmo sem dados de programa.
        $leve = bb_leve_por_id($id);
        $pessoa = $leve ? bb_carregar_pessoa($leve) : null;
        if (!$pessoa) bb_erro("{$env['papel']}: currículo não encontrado na base. Envie o arquivo XML ou ZIP do Lattes.");
    } elseif ($texto($env['chave'] . 'Id') !== '') {
        bb_erro("{$env['papel']}: informe um link ou ID Lattes válido (16 dígitos).");
    }
    $soNome = false;
    if (!$pessoa && ($nome = bb_cortar($texto($env['chave'] . 'Nome'), 200)) !== '') {
        // Sem currículo: registro mínimo com o nome. vinc_verificar procura o
        // nome nas coautorias e orientações de cada pessoa indicada.
        $pessoa = ['id' => '', 'nome' => $nome, 'citacoes' => []];
        $soNome = true;
    }
    if ($pessoa) {
        $envolvidos[] = ['papel' => $env['papel'], 'pessoa' => $pessoa];
        $avisos[$env['chave']] = $soNome ? ['nome' => $pessoa['nome'], 'soNome' => true] : $pessoa['nome'];
        $considerados[] = ['chave' => $env['chave'], 'papel' => $env['papel'], 'nome' => $pessoa['nome'], 'id' => vinc_id_lattes($pessoa['id'] ?? ''), 'soNome' => $soNome];
    }
}

// Um só índice para toda a base (o IDF considera todos os currículos); o
// ranking vem na ordem exibida e é separado por lista. Filtros: instituição
// (do Lattes ou do programa), doutorado e situação Permanente (13.1).
$somentePermanentes = $texto('somentePermanentes') === '1';
$ranking = bb_buscar($indice, $visao, $consulta, [
    'excluirInstituicao' => $texto('excluirInstituicao'),
    'somenteDoutores' => $texto('somenteDoutores') === '1',
    'somentePermanentes' => $somentePermanentes,
]);

$periodo = (int) $texto('periodo');
$desdeAno = in_array($periodo, [5, 10], true) ? (int) date('Y') - $periodo + 1 : 0;
$listas = [];
foreach (BB_GRUPOS as $grupo => $titulo) {
    $listas[$grupo] = ['grupo' => $grupo, 'titulo' => $titulo, 'resultados' => [], 'retirados' => [],
        'total' => $visao['totais'][$grupo] ?? 0,
        'foraSituacao' => $somentePermanentes ? ($visao['foraSituacao'][$grupo] ?? 0) : 0];
}
// Percorre o ranking: quem tem vínculo sai da lista do seu grupo (e é
// exibido à parte) até cada lista ter 10 pessoas sem vínculo.
foreach ($ranking as $r) {
    $l = &$listas[$r['grupo']];
    if (count($l['resultados']) < LIMITE) {
        $item = ['pessoa' => bb_publico($r['pessoa']), 'score' => round($r['score'], 4), 'termos' => $r['termos']];
        // Vínculos pedem o registro completo (produções e coautores), lido só
        // para quem chega à lista.
        $completo = $envolvidos ? bb_carregar_pessoa($r['pessoa']) : null;
        $vinculos = $completo ? vinc_verificar($completo, $envolvidos, $desdeAno) : [];
        if ($vinculos) $l['retirados'][] = $item + ['vinculos' => $vinculos];
        else $l['resultados'][] = $item;
    }
    unset($l);
    $completas = true;
    foreach ($listas as $x) if (count($x['resultados']) < LIMITE) $completas = false;
    if ($completas) break;
}

bb_json([
    'listas' => array_values($listas),
    'envolvidos' => $avisos,
    'conformidade' => ['verificada' => (bool) $envolvidos, 'considerados' => $considerados],
]);
