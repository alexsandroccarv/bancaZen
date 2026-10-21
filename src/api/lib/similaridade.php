<?php
/* ==========================================================================
   bancaZen — Proximidade temática (TF-IDF + cosseno)
   --------------------------------------------------------------------------
   Cada currículo vira um vetor de termos ponderados; o trabalho informado
   (título, resumo, palavras-chave) vira outro. A proximidade é o cosseno
   entre os dois vetores: como todos os pesos são positivos, o valor fica
   sempre entre 0 (nenhum termo em comum) e 1 (mesmo perfil de termos).

   Etapas do texto: minúsculas, remoção de acentos, palavras vazias
   (português e inglês), radical leve (plural e vogal temática) e bigramas
   (ex.: "administracao publica"), que distinguem expressões compostas.

   Pesos por campo do currículo (o que a pessoa declara como foco pesa mais
   do que o que aparece de passagem): SIM_PESOS_CURRICULO. Produções antigas
   pesam menos (sim_peso_recencia). Na consulta, palavras-chave e título
   pesam mais que o resumo (SIM_PESOS_CONSULTA).
   ========================================================================== */

const SIM_PESOS_CURRICULO = [
    'palavrasChave' => 3, 'linhas' => 2.5, 'areas' => 2, 'formacao' => 2,
    'producoes' => 1.5, 'projetos' => 1.5, 'orientacoes' => 1, 'resumo' => 1,
];
const SIM_PESOS_CONSULTA = ['palavrasChave' => 3, 'titulo' => 2, 'resumo' => 1];
const SIM_PESO_BIGRAMA = 1.5;

// Produções dos últimos 10 anos valem integralmente; antes disso o peso cai
// até 0,4, para privilegiar a atuação recente sem descartar a antiga.
function sim_peso_recencia($ano, int $anoAtual): float
{
    $a = (int) $ano;
    if (!$a) return 0.8;
    $idade = $anoAtual - $a;
    if ($idade <= 10) return 1.0;
    return max(0.4, 1 - ($idade - 10) * 0.04);
}

/* ------------------------------ normalização ----------------------------- */
function sim_stopwords(): array
{
    static $stop = null;
    if ($stop === null) {
        $stop = array_fill_keys(preg_split('/\s+/', trim(
            // português
            'a ao aos as ate com como da das de dei do dos e ela elas ele eles em entre era essa esse esta este eu foi ' .
            'for ha isso isto ja la mais mas me mesmo meu minha muito na nas nao nem no nos nossa nosso num numa o os ou ' .
            'para pela pelas pelo pelos por qual quando que quem se sem ser seu seus sua suas so sob sobre tambem te tem ' .
            'ter seja sao foram sendo tal tais uma umas um uns vez cada outro outra outros outras onde apos ' .
            'atraves partir assim ainda bem desde durante pois porque todo toda todos todas estes estas ' .
            'aquele aquela deste desta destes destas neste nesta nesse nessa dessa desse cujo cuja ' .
            // inglês
            'the of and in on for to with by from an at is are was were be this that these those its as or not ' .
            'into their which using use based ' .
            // genéricas de textos acadêmicos (aparecem em quase todo título)
            'estudo estudos analise analises caso casos uso trabalho pesquisa pesquisas proposta ' .
            'dissertacao tese artigo objetivo objetivos resultado resultados forma meio meios contexto ' .
            'study analysis case approach paper research'
        )), true);
    }
    return $stop;
}

// Minúsculas sem acento, sem depender de mbstring/intl.
function sim_sem_acento(string $s): string
{
    static $mapa = null;
    if ($mapa === null) {
        $de = ['á','à','â','ã','ä','å','é','è','ê','ë','í','ì','î','ï','ó','ò','ô','õ','ö','ú','ù','û','ü','ç','ñ','ý','ÿ',
               'Á','À','Â','Ã','Ä','Å','É','È','Ê','Ë','Í','Ì','Î','Ï','Ó','Ò','Ô','Õ','Ö','Ú','Ù','Û','Ü','Ç','Ñ','Ý'];
        $para = ['a','a','a','a','a','a','e','e','e','e','i','i','i','i','o','o','o','o','o','u','u','u','u','c','n','y','y',
                 'a','a','a','a','a','a','e','e','e','e','i','i','i','i','o','o','o','o','o','u','u','u','u','c','n','y'];
        $mapa = array_combine($de, $para);
    }
    $s = strtr($s, $mapa);
    return function_exists('mb_strtolower') ? mb_strtolower($s, 'UTF-8') : strtolower($s);
}

// Radical leve: plurais e vogal temática final. Não é um stemmer completo
// (como o RSLP), mas aproxima "politicas publicas" de "politica publica" e
// "gestoes" de "gestao" sem fundir palavras de sentidos distintos.
function sim_radical(string $w): string
{
    if (strlen($w) <= 3) return $w;
    $fim = fn($suf) => substr($w, -strlen($suf)) === $suf;
    if ($fim('coes')) $w = substr($w, 0, -4) . 'cao';
    elseif ($fim('oes') || $fim('aes')) $w = substr($w, 0, -3) . 'ao';
    elseif ($fim('ais')) $w = substr($w, 0, -3) . 'al';
    elseif ($fim('eis') && strlen($w) > 5) $w = substr($w, 0, -3) . 'el';
    elseif ($fim('ns')) $w = substr($w, 0, -2) . 'm';
    elseif ($fim('res') || $fim('zes')) $w = substr($w, 0, -2);
    elseif ($fim('s') && !$fim('ss') && !$fim('us') && !$fim('is')) $w = substr($w, 0, -1);
    if (strlen($w) > 4 && preg_match('/[aoe]$/', $w)) $w = substr($w, 0, -1);
    return $w;
}

// Texto -> lista de ['r' => radical, 'f' => palavra original (para exibir),
// 'p' => posição da palavra no texto, contando as palavras vazias].
function sim_tokens(?string $texto): array
{
    $out = [];
    if (!$texto || !preg_match_all('/[\p{L}\p{N}]+/u', $texto, $mm)) return $out;
    $stop = sim_stopwords();
    foreach ($mm[0] as $pos => $forma) {
        $w = sim_sem_acento($forma);
        if (strlen($w) < 3 || isset($stop[$w]) || ctype_digit($w)) continue;
        $out[] = ['r' => sim_radical($w), 'f' => function_exists('mb_strtolower') ? mb_strtolower($forma, 'UTF-8') : strtolower($forma), 'p' => $pos];
    }
    return $out;
}

// Soma em $tf os termos (e bigramas) de $texto, com o peso dado.
function sim_acumular(array &$tf, ?string $texto, float $peso, ?array &$formas = null): void
{
    $tk = sim_tokens($texto);
    $n = count($tk);
    for ($i = 0; $i < $n; $i++) {
        $r = $tk[$i]['r'];
        $tf[$r] = ($tf[$r] ?? 0) + $peso;
        if ($formas !== null && !isset($formas[$r])) $formas[$r] = $tk[$i]['f'];
        if ($i > 0) {
            $bg = $tk[$i - 1]['r'] . ' ' . $r;
            $tf[$bg] = ($tf[$bg] ?? 0) + $peso * SIM_PESO_BIGRAMA;
            // Só exibe o bigrama quando as palavras são vizinhas no texto
            // ("transparência ativa"), e não separadas por palavras vazias.
            if ($formas !== null && empty($formas[$bg]) && $tk[$i]['p'] === $tk[$i - 1]['p'] + 1) {
                $formas[$bg] = $tk[$i - 1]['f'] . ' ' . $tk[$i]['f'];
            }
        }
    }
}

function sim_tf_curriculo(array $p, int $anoAtual): array
{
    $tf = [];
    $w = SIM_PESOS_CURRICULO;
    sim_acumular($tf, $p['resumo'] ?? '', $w['resumo']);
    foreach ($p['palavrasChave'] ?? [] as $t) sim_acumular($tf, $t, $w['palavrasChave']);
    foreach ($p['areas'] ?? [] as $t) sim_acumular($tf, $t, $w['areas']);
    foreach ($p['linhas'] ?? [] as $t) sim_acumular($tf, $t, $w['linhas']);
    foreach (['formacao', 'producoes', 'projetos', 'orientacoes'] as $campo) {
        foreach ($p[$campo] ?? [] as $it) sim_acumular($tf, $it['t'], $w[$campo] * sim_peso_recencia($it['a'] ?? '', $anoAtual));
    }
    return $tf;
}

// Frequência sublinear: evita que um currículo muito extenso domine só por
// repetir o mesmo termo centenas de vezes.
function sim_vetor(array $tf, array $idf): array
{
    $v = [];
    $norma = 0.0;
    foreach ($tf as $t => $f) {
        $peso = (1 + log($f)) * ($idf[$t] ?? 0);
        if ($peso > 0) { $v[$t] = $peso; $norma += $peso * $peso; }
    }
    return ['v' => $v, 'norma' => sqrt($norma)];
}

/* --------------------------------- índice -------------------------------- */
function sim_criar_indice(array $pessoas, ?int $anoAtual = null): array
{
    $anoAtual = $anoAtual ?: (int) date('Y');
    $tfs = array_map(fn($p) => sim_tf_curriculo($p, $anoAtual), $pessoas);
    $df = [];
    foreach ($tfs as $tf) foreach ($tf as $t => $_) $df[$t] = ($df[$t] ?? 0) + 1;
    $N = count($pessoas);
    // IDF suavizado: termo presente em todos os currículos ainda vale um pouco.
    $idf = [];
    foreach ($df as $t => $n) $idf[$t] = log(($N + 1) / ($n + 1)) + 1;
    $docs = [];
    foreach ($tfs as $i => $tf) $docs[] = ['pessoa' => $pessoas[$i]] + sim_vetor($tf, $idf);
    return ['docs' => $docs, 'idf' => $idf, 'N' => $N];
}

/* --------------------------------- busca --------------------------------- */
// $consulta = ['titulo', 'resumo', 'palavrasChave' => string[]]
// $opcoes   = ['limite', 'excluirInstituicao', 'somenteDoutores']
function sim_buscar(array $indice, array $consulta, array $opcoes = []): array
{
    $limite = $opcoes['limite'] ?? 10;
    $tf = [];
    $formas = [];
    foreach ($consulta['palavrasChave'] ?? [] as $k) sim_acumular($tf, $k, SIM_PESOS_CONSULTA['palavrasChave'], $formas);
    sim_acumular($tf, $consulta['titulo'] ?? '', SIM_PESOS_CONSULTA['titulo'], $formas);
    sim_acumular($tf, $consulta['resumo'] ?? '', SIM_PESOS_CONSULTA['resumo'], $formas);
    $q = sim_vetor($tf, $indice['idf']);
    if (!$q['norma']) return ['resultados' => [], 'termosConsulta' => 0, 'avaliados' => 0];

    $excluir = trim(sim_sem_acento($opcoes['excluirInstituicao'] ?? ''));
    $candidatos = array_values(array_filter($indice['docs'], function ($d) use ($opcoes, $excluir) {
        if (!empty($opcoes['somenteDoutores']) && ($d['pessoa']['nivel'] ?? 0) < 5) return false; // 5 = Doutorado
        if ($excluir !== '' && str_contains(sim_sem_acento($d['pessoa']['instituicao'] ?? ''), $excluir)) return false;
        return true;
    }));

    $resultados = [];
    foreach ($candidatos as $d) {
        $prod = 0.0;
        $contrib = [];
        foreach ($q['v'] as $t => $qw) {
            if (isset($d['v'][$t])) { $c = $qw * $d['v'][$t]; $prod += $c; $contrib[$t] = $c; }
        }
        if ($prod <= 0) continue;
        $score = $d['norma'] ? min(1.0, $prod / ($q['norma'] * $d['norma'])) : 0.0;
        arsort($contrib);
        // Termos em comum que mais pesaram (sem repetir a palavra de um bigrama já listado).
        $termos = [];
        foreach (array_keys($contrib) as $t) {
            $f = $formas[(string) $t] ?? '';
            if ($f === '') continue;
            foreach ($termos as $x) if (str_contains($x, $f) || str_contains($f, $x)) continue 2;
            $termos[] = $f;
            if (count($termos) >= 6) break;
        }
        $resultados[] = ['pessoa' => $d['pessoa'], 'score' => $score, 'termos' => $termos];
    }

    usort($resultados, fn($a, $b) => ($b['score'] <=> $a['score'])
        ?: strcmp(sim_sem_acento($a['pessoa']['nome']), sim_sem_acento($b['pessoa']['nome'])));
    return [
        'resultados' => $limite === INF ? $resultados : array_slice($resultados, 0, $limite),
        'termosConsulta' => count($q['v']),
        'avaliados' => count($candidatos),
    ];
}
