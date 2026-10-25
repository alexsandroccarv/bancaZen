<?php
/* ==========================================================================
   bancaZen — Proximidade temática (BM25)
   --------------------------------------------------------------------------
   Cada currículo vira um conjunto de termos com frequência ponderada; o
   trabalho informado (título, resumo, palavras-chave) vira a consulta. A
   pontuação é a do BM25: cada termo em comum soma IDF x frequência saturada
   (repetir o termo rende cada vez menos, k1) e ajustada ao tamanho do
   currículo (currículos muito extensos não levam vantagem só pelo volume,
   b). A proximidade exibida (0 a 1) é a pontuação dividida pelo máximo que a
   consulta poderia alcançar (todos os termos com frequência sem limite).

   Etapas do texto: minúsculas, remoção de acentos, palavras vazias
   (português e inglês), radical leve (plural e vogal temática) e bigramas
   (ex.: "administracao publica"), que distinguem expressões compostas.

   Pesos por campo do currículo (o que a pessoa declara como foco pesa mais
   do que o que aparece de passagem): SIM_PESOS_CURRICULO. Produções antigas
   pesam menos (sim_peso_recencia). Na consulta, palavras-chave e título
   pesam mais que o resumo (SIM_PESOS_CONSULTA).
   ========================================================================== */

// Artigos (em periódicos, com avaliação por pares) pesam mais que as demais
// produções; títulos das bancas de que a pessoa participou (mestrado,
// doutorado, qualificação) mostram os temas que ela já avaliou.
const SIM_PESOS_CURRICULO = [
    'palavrasChave' => 3, 'linhas' => 2.5, 'areas' => 2, 'formacao' => 2, 'artigos' => 2, 'bancas' => 2,
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
    foreach (['formacao', 'producoes', 'projetos', 'orientacoes', 'bancas'] as $campo) {
        foreach ($p[$campo] ?? [] as $it) {
            $peso = $campo === 'producoes' && ($it['tp'] ?? '') === 'a' ? $w['artigos'] : $w[$campo];
            sim_acumular($tf, $it['t'], $peso * sim_peso_recencia($it['a'] ?? '', $anoAtual));
        }
    }
    return $tf;
}

const SIM_BM25_K1 = 1.2;  // saturação da frequência
const SIM_BM25_B = 0.75;  // ajuste ao tamanho do currículo
const SIM_MODELO = 'bm25-2'; // muda quando o índice gravado precisa ser refeito
const SIM_CASAS_EXIBIDAS = 2; // proximidade exibida com 2 casas (0,12)

// IDF do BM25 (sempre positivo): termo raro vale mais.
function sim_idf(int $N, int $n): float
{
    return log(1 + ($N - $n + 0.5) / ($n + 0.5));
}

/* --------------------------------- índice -------------------------------- */
// Índice em memória: docs[k] = ['pessoa', 'tf' => [termo => frequência],
// 'comprimento' => soma das frequências]; 'media' = comprimento médio.
function sim_criar_indice(array $pessoas, ?int $anoAtual = null): array
{
    $anoAtual = $anoAtual ?: (int) date('Y');
    $docs = [];
    $df = [];
    $soma = 0.0;
    foreach (array_values($pessoas) as $k => $p) {
        $tf = sim_tf_curriculo($p, $anoAtual);
        foreach ($tf as $t => $_) $df[$t] = ($df[$t] ?? 0) + 1;
        $docs[$k] = ['pessoa' => $p, 'tf' => $tf, 'comprimento' => array_sum($tf)];
        $soma += $docs[$k]['comprimento'];
    }
    $N = count($docs);
    $idf = [];
    foreach ($df as $t => $n) $idf[$t] = sim_idf($N, $n);
    return ['docs' => $docs, 'idf' => $idf, 'N' => $N, 'media' => $N ? $soma / $N : 0.0];
}

/* --------------------------------- busca --------------------------------- */
// $consulta = ['titulo', 'resumo', 'palavrasChave' => string[]]
// $opcoes   = ['limite', 'excluirInstituicao', 'somenteDoutores']
// Busca no índice em memória (sim_criar_indice): usada nos testes e como
// referência; o site usa o índice gravado (sim_pontuar_postagens), com o
// mesmo cálculo.
function sim_buscar(array $indice, array $consulta, array $opcoes = []): array
{
    [$tf, $formas] = sim_consulta($consulta);
    $docs = [];
    $postagens = [];
    foreach ($indice['docs'] as $k => $d) {
        $docs[$k] = ['pessoa' => $d['pessoa'], 'comprimento' => $d['comprimento']];
        foreach ($tf as $t => $_) if (isset($d['tf'][$t])) $postagens[$t][$k] = $d['tf'][$t];
    }
    $termo = fn($t) => isset($indice['idf'][$t]) ? [$indice['idf'][$t], $postagens[$t] ?? []] : null;
    return sim_pontuar($tf, $formas, $termo, $docs, $indice['media'], $opcoes);
}

// Busca no índice gravado (lib/indice.php): $termo($t) devolve [idf,
// postagens] (string com pack('VV', doc, frequência × 10000) por currículo,
// em ordem de doc) ou null; $comprimento($doc) e $aceita($doc) (filtros) vêm
// do índice. Só os currículos com algum termo da consulta são avaliados, e
// as postagens são lidas em trechos: a memória não cresce com a base.
// Devolve os pontos (doc => soma BM25), o máximo possível da consulta e o
// necessário para sim_termos_comuns.
function sim_pontuar_postagens(array $tf, callable $termo, callable $comprimento, callable $aceita, float $media): array
{
    $k1 = SIM_BM25_K1;
    $b = SIM_BM25_B;
    $q = [];
    $maximo = 0.0;
    $postagens = [];
    foreach ($tf as $t => $f) {
        $info = $termo((string) $t);
        if (!$info || $info[0] <= 0) continue;
        $q[$t] = (1 + log($f)) * $info[0];
        $maximo += $q[$t] * ($k1 + 1);
        $postagens[$t] = $info[1];
    }
    $pontos = [];
    $ok = [];
    $ajustes = [];
    foreach ($q as $t => $qw) {
        $pk = $postagens[$t];
        $n = strlen($pk);
        for ($o = 0; $o < $n; $o += 65536) {
            $v = unpack('V*', substr($pk, $o, 65536));
            for ($i = 1, $m = count($v); $i < $m; $i += 2) {
                $d = $v[$i];
                if (!($ok[$d] ??= $aceita($d))) continue;
                $aj = $ajustes[$d] ??= ($media > 0 ? 1 - $b + $b * ($comprimento($d) / $media) : 1.0);
                $f = $v[$i + 1] / 10000;
                $pontos[$d] = ($pontos[$d] ?? 0.0) + $qw * ($f * ($k1 + 1)) / ($f + $k1 * $aj);
            }
        }
    }
    return ['pontos' => $pontos, 'maximo' => $maximo, 'q' => $q, 'postagens' => $postagens];
}
// Frequência de um currículo nas postagens de um termo (busca binária).
function sim_postagem(string $pk, int $doc): ?float
{
    $lo = 0;
    $hi = intdiv(strlen($pk), 8) - 1;
    while ($lo <= $hi) {
        $meio = ($lo + $hi) >> 1;
        [, $d, $f] = unpack('V2', substr($pk, $meio * 8, 8));
        if ($d === $doc) return $f / 10000;
        if ($d < $doc) $lo = $meio + 1;
        else $hi = $meio - 1;
    }
    return null;
}
// Termos em comum de um currículo do resultado de sim_pontuar_postagens.
function sim_termos_comuns(array $r, array $formas, int $doc, float $comprimento, float $media): array
{
    $k1 = SIM_BM25_K1;
    $b = SIM_BM25_B;
    $ajuste = $media > 0 ? 1 - $b + $b * ($comprimento / $media) : 1.0;
    $c = [];
    foreach ($r['q'] as $t => $qw) {
        $f = sim_postagem($r['postagens'][$t], $doc);
        if ($f !== null) $c[$t] = $qw * ($f * ($k1 + 1)) / ($f + $k1 * $ajuste);
    }
    return sim_termos($c, $formas);
}
// Termos em comum que mais pesaram (até 6, sem repetir a palavra de um
// bigrama já listado), na forma escrita na consulta.
function sim_termos(array $c, array $formas): array
{
    arsort($c);
    $termos = [];
    foreach (array_keys($c) as $t) {
        $f = $formas[(string) $t] ?? '';
        if ($f === '') continue;
        foreach ($termos as $x) if (str_contains($x, $f) || str_contains($f, $x)) continue 2;
        $termos[] = $f;
        if (count($termos) >= 6) break;
    }
    return $termos;
}

// Ordem das sugestões: proximidade como exibida (2 casas), decrescente; no
// empate (ex.: três pessoas com 0,12), as de sexo feminino primeiro; depois a
// proximidade sem arredondar e o nome. $feminina($pessoa) diz se é do sexo
// feminino (o dado vem do índice, não do registro exibido).
function sim_ordenar(array $resultados, callable $feminina): array
{
    $chave = fn($r) => round($r['score'], SIM_CASAS_EXIBIDAS);
    usort($resultados, fn($a, $b) => ($chave($b) <=> $chave($a))
        ?: ((int) $feminina($b['pessoa']) <=> (int) $feminina($a['pessoa']))
        ?: ($b['score'] <=> $a['score'])
        ?: strcmp(sim_sem_acento($a['pessoa']['nome']), sim_sem_acento($b['pessoa']['nome'])));
    return $resultados;
}

// Termos da consulta (com pesos por campo) e a forma original de cada um.
function sim_consulta(array $consulta): array
{
    $tf = [];
    $formas = [];
    foreach ($consulta['palavrasChave'] ?? [] as $k) sim_acumular($tf, $k, SIM_PESOS_CONSULTA['palavrasChave'], $formas);
    sim_acumular($tf, $consulta['titulo'] ?? '', SIM_PESOS_CONSULTA['titulo'], $formas);
    sim_acumular($tf, $consulta['resumo'] ?? '', SIM_PESOS_CONSULTA['resumo'], $formas);
    return [$tf, $formas];
}

// BM25 entre a consulta e cada currículo que tem algum termo em comum. O
// peso de cada termo da consulta é sublinear (1 + log), como antes.
function sim_pontuar(array $tf, array $formas, callable $termo, array $docs, float $media, array $opcoes): array
{
    $limite = $opcoes['limite'] ?? 10;
    $k1 = SIM_BM25_K1;
    $b = SIM_BM25_B;
    $q = [];
    $maximo = 0.0;
    $postagens = [];
    foreach ($tf as $t => $f) {
        $info = $termo((string) $t);
        if (!$info || $info[0] <= 0) continue;
        $q[$t] = (1 + log($f)) * $info[0];
        $maximo += $q[$t] * ($k1 + 1); // frequência sem limite: fator k1 + 1
        $postagens[$t] = $info[1];
    }
    if (!$maximo) return ['resultados' => [], 'termosConsulta' => 0, 'avaliados' => 0];

    $excluir = trim(sim_sem_acento($opcoes['excluirInstituicao'] ?? ''));
    $produto = [];
    $contrib = [];
    foreach ($q as $t => $qw) {
        foreach ($postagens[$t] as $k => $f) {
            if (!isset($docs[$k])) continue;
            $ajuste = $media > 0 ? 1 - $b + $b * ($docs[$k]['comprimento'] / $media) : 1.0;
            $c = $qw * ($f * ($k1 + 1)) / ($f + $k1 * $ajuste);
            $produto[$k] = ($produto[$k] ?? 0.0) + $c;
            $contrib[$k][$t] = $c;
        }
    }

    $resultados = [];
    $avaliados = 0;
    foreach ($docs as $k => $d) {
        $p = $d['pessoa'];
        if (!empty($opcoes['somenteDoutores']) && ($p['nivel'] ?? 0) < 5) continue; // 5 = Doutorado
        if ($excluir !== '' && str_contains(sim_sem_acento($p['instituicao'] ?? ''), $excluir)) continue;
        $avaliados++;
        $prod = $produto[$k] ?? 0.0;
        if ($prod <= 0) continue;
        $score = min(1.0, $prod / $maximo);
        $resultados[] = ['pessoa' => $p, 'score' => $score, 'termos' => sim_termos($contrib[$k], $formas)];
    }

    usort($resultados, fn($a, $b) => ($b['score'] <=> $a['score'])
        ?: strcmp(sim_sem_acento($a['pessoa']['nome']), sim_sem_acento($b['pessoa']['nome'])));
    return [
        'resultados' => $limite === INF ? $resultados : array_slice($resultados, 0, $limite),
        'termosConsulta' => count($q),
        'avaliados' => $avaliados,
    ];
}
