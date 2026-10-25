<?php
/* ==========================================================================
   bancaZen — índice de busca (formato 3) e visão para a busca
   --------------------------------------------------------------------------
   Feito para bases grandes (100 mil currículos ou mais) com memória fixa:
   a busca lê só o que a consulta usa.

   <dados>/indice/   depende só do corpus (refeito quando ele muda)
     meta.json       formato, modelo, assinatura do corpus, ano, N, média
     docs.bin        por currículo k (BB_DOC bytes): ID Lattes (16),
                     comprimento × 10000 (uint64) e sexo (F, M ou espaço)
     dic/<xxx>.tsv   dicionário, 4096 partes pelo md5 do termo (cada busca
                     lê só as partes dos seus termos, sem guardá-las); uma
                     linha "termo<TAB>idf<TAB>posição<TAB>quantidade"
     postagens.bin   para cada termo, pack('VV', k, frequência × 10000) por
                     currículo, em ordem de k (BB_POSTAGEM bytes cada)

   <dados>/visao/    depende do índice, do corpus e da lista de docentes
     meta.json       totais por lista, fora pela situação, currículos com
                     dados, instituições (sem acento) e universidades
     docs.bin        por k (5 bytes): marcas (BB_V_*), instituição do Lattes
                     e instituição do programa (posições em "instituicoes")
     leves/<xx>.jsonl  registro leve de cada currículo do corpus, com o
                     programa efetivo (lista de docentes > envio), uma linha
                     "id<TAB>json"; lido só para quem aparece no resultado

   A construção percorre o corpus em trechos (bb_json_registros) e grava as
   postagens em 256 arquivos temporários: a memória não cresce com a base.
   Bases pequenas são indexadas na própria busca; acima de BB_INDICE_WEB_MAX
   bytes de corpus.json, pela Administração ou por
   `php api/cli/indexar.php` (cron).
   ========================================================================== */

const BB_INDICE_FORMATO = 3;
const BB_DOC = 25;
const BB_POSTAGEM = 8;
// corpus.json até ~2 MB (cerca de 3 mil currículos): a busca refaz o índice
// sozinha. Acima disso, usa o índice existente até a próxima indexação.
const BB_INDICE_WEB_MAX = 2000000;
// Marcas da visão (docs.bin): dados de programa, doutorado, permanente e lista.
const BB_V_DADOS = 1;
const BB_V_DOUTOR = 2;
const BB_V_PERMANENTE = 4;
const BB_V_PROFIAP = 8;

// Assinatura de um arquivo: md5 até 16 MB; acima, tamanho e data (o md5 de
// um arquivo grande a cada busca custaria caro).
function bb_assinatura_arquivo(string $arq): string
{
    clearstatcache(true, $arq);
    if (!is_file($arq)) return '';
    $t = (int) filesize($arq);
    return $t < 16000000 ? (string) md5_file($arq) : $t . '-' . filemtime($arq);
}
function bb_parte(string $s): string
{
    return substr(md5($s), 0, 2);
}
// Parte do dicionário (3 hex): dentro da parte temporária bb_parte (2 hex).
function bb_parte_dic(string $t): string
{
    return substr(md5($t), 0, 3);
}

/* ------------------------------ índice ----------------------------------- */
function bb_indice_meta(): ?array
{
    $m = bb_dir_dados() . '/indice/meta.json';
    $d = is_file($m) ? json_decode((string) file_get_contents($m), true) : null;
    return is_array($d) ? $d : null;
}
// Índice do mesmo corpus, do mesmo ano (peso da recência), modelo e formato.
function bb_indice_valido(?array $m, string $assinatura): bool
{
    return $m && ($m['formato'] ?? 0) === BB_INDICE_FORMATO && ($m['assinatura'] ?? '') === $assinatura
        && ($m['ano'] ?? 0) === (int) date('Y') && ($m['modelo'] ?? '') === SIM_MODELO;
}
// Devolve o meta do índice, refazendo-o se o corpus mudou. Na web ($web),
// base grande não é indexada aqui: vale o índice existente (marcado
// "desatualizado") ou, sem nenhum, um erro que pede a indexação.
function bb_indice_garantir(bool $web = false, bool $forcar = false, ?callable $progresso = null): array
{
    bb_migrar_corpus();
    $corpus = bb_dir_dados() . '/corpus.json';
    $m = bb_indice_meta();
    if (!$forcar && bb_indice_valido($m, bb_assinatura_arquivo($corpus))) return $m;
    if ($web && is_file($corpus) && filesize($corpus) > BB_INDICE_WEB_MAX) {
        if ($m && ($m['formato'] ?? 0) === BB_INDICE_FORMATO && ($m['modelo'] ?? '') === SIM_MODELO) return $m + ['desatualizado' => true];
        throw new RuntimeException('O índice de busca ainda não foi montado para esta base. A administração precisa indexar os currículos.');
    }
    return bb_indice_construir($forcar, $progresso);
}
function bb_indice_construir(bool $forcar = false, ?callable $progresso = null): array
{
    $dir = bb_preparar_dados();
    $trava = fopen("$dir/indice.lock", 'c');
    flock($trava, LOCK_EX);
    $novo = "$dir/indice.novo-" . bin2hex(random_bytes(4));
    try {
        $assinatura = bb_assinatura_arquivo("$dir/corpus.json");
        $m = bb_indice_meta();
        if (!$forcar && bb_indice_valido($m, $assinatura)) return $m; // outro processo já fez
        @set_time_limit(0);
        $avisar = $progresso ?? fn(string $msg) => null;
        $ano = (int) date('Y');
        foreach (["$novo/dic", "$novo/tmp"] as $d) @mkdir($d, 0750, true);

        // 1º passe: um currículo por vez; docs.bin em sequência e as
        // postagens em 256 arquivos temporários (pela parte do termo).
        $hDocs = fopen("$novo/docs.bin", 'wb');
        $buf = [];
        $descarregar = function (string $p) use (&$buf, $novo) {
            file_put_contents("$novo/tmp/$p", $buf[$p], FILE_APPEND);
            $buf[$p] = '';
        };
        $k = 0;
        $soma = 0.0;
        $postagens = 0;
        if (is_file("$dir/corpus.json")) {
            bb_json_registros("$dir/corpus.json", function (string $id, array $leve) use (&$k, &$soma, &$buf, &$postagens, $descarregar, $hDocs, $ano, $avisar) {
                $p = bb_carregar_pessoa($leve);
                if (!$p) return;
                $tf = sim_tf_curriculo($p, $ano);
                foreach ($tf as $t => $f) {
                    $f = (int) round($f * 10000);
                    if ($f <= 0) continue;
                    $parte = bb_parte((string) $t);
                    $buf[$parte] = ($buf[$parte] ?? '') . "$t\t$k\t$f\n";
                    if (strlen($buf[$parte]) > 32768) $descarregar($parte);
                    $postagens++;
                }
                $comprimento = round(array_sum($tf), 4);
                $sexo = in_array($p['sexo'] ?? '', ['F', 'M'], true) ? $p['sexo'] : ' ';
                fwrite($hDocs, str_pad(vinc_id_lattes((string) $p['id']), 16, '0', STR_PAD_LEFT) . pack('P', (int) round($comprimento * 10000)) . $sexo);
                $soma += $comprimento;
                if (++$k % 1000 === 0) $avisar("$k currículos lidos");
            });
        }
        fclose($hDocs);
        foreach (array_keys($buf) as $p) if ($buf[$p] !== '') $descarregar($p);
        $N = $k;
        $avisar("$N currículos lidos; montando o dicionário");

        // 2º passe: cada parte vira um trecho do dicionário e das postagens.
        $hPost = fopen("$novo/postagens.bin", 'wb');
        $pos = 0;
        $vocabulario = 0;
        foreach (glob("$novo/tmp/*") ?: [] as $arq) {
            $termos = [];
            $h = fopen($arq, 'rb');
            while (($linha = fgets($h)) !== false) {
                [$t, $d, $f] = explode("\t", rtrim($linha, "\n"));
                if (!isset($termos[$t])) $termos[$t] = '';
                $termos[$t] .= pack('VV', (int) $d, (int) $f);
            }
            fclose($h);
            unlink($arq);
            $dic = [];
            foreach ($termos as $t => $pk) {
                $n = intdiv(strlen($pk), BB_POSTAGEM);
                $p3 = bb_parte_dic((string) $t);
                $dic[$p3] = ($dic[$p3] ?? '') . $t . "\t" . round(sim_idf($N, $n), 6) . "\t$pos\t$n\n";
                fwrite($hPost, $pk);
                $pos += strlen($pk);
                $vocabulario++;
            }
            foreach ($dic as $p3 => $linhas) file_put_contents("$novo/dic/$p3.tsv", $linhas);
            unset($termos, $dic);
        }
        fclose($hPost);
        @rmdir("$novo/tmp");
        $meta = ['formato' => BB_INDICE_FORMATO, 'modelo' => SIM_MODELO, 'assinatura' => $assinatura, 'ano' => $ano,
            'N' => $N, 'media' => $N ? $soma / $N : 0.0, 'vocabulario' => $vocabulario, 'postagens' => $postagens,
            'criadoEm' => date('c')];
        file_put_contents("$novo/meta.json", json_encode($meta));
        // Troca atômica da pasta do índice.
        $velho = "$dir/indice.velho-" . bin2hex(random_bytes(4));
        if (is_dir("$dir/indice")) rename("$dir/indice", $velho);
        rename($novo, "$dir/indice");
        if (is_dir($velho)) bb_apagar_pasta($velho);
        $avisar("índice pronto: $N currículos, $vocabulario termos, $postagens postagens");
        return $meta;
    } finally {
        if (is_dir($novo)) bb_apagar_pasta($novo);
        flock($trava, LOCK_UN);
        fclose($trava);
    }
}

/* ------------------------------- visão ------------------------------------ */
function bb_visao_meta(): ?array
{
    $m = bb_dir_dados() . '/visao/meta.json';
    $d = is_file($m) ? json_decode((string) file_get_contents($m), true) : null;
    return is_array($d) ? $d : null;
}
function bb_visao_assinatura(array $indice): string
{
    $dir = bb_dir_dados();
    return ($indice['criadoEm'] ?? '') . '|' . bb_assinatura_arquivo("$dir/corpus.json") . '|' . bb_assinatura_arquivo("$dir/docentes.json");
}
function bb_visao_garantir(array $indice, bool $forcar = false, ?callable $progresso = null): array
{
    $m = bb_visao_meta();
    if (!$forcar && $m && ($m['assinatura'] ?? '') === bb_visao_assinatura($indice)) return $m;
    return bb_visao_construir($indice, $progresso, $forcar);
}
function bb_visao_construir(array $indice, ?callable $progresso = null, bool $forcar = false): array
{
    $dir = bb_preparar_dados();
    $trava = fopen("$dir/visao.lock", 'c');
    flock($trava, LOCK_EX);
    $novo = "$dir/visao.novo-" . bin2hex(random_bytes(4));
    try {
        $assinatura = bb_visao_assinatura($indice);
        $m = bb_visao_meta();
        if (!$forcar && $m && ($m['assinatura'] ?? '') === $assinatura) return $m; // outro processo já fez
        @set_time_limit(0);
        $avisar = $progresso ?? fn(string $msg) => null;
        @mkdir("$novo/leves", 0750, true);

        // Universidades para "Minha Instituição Associada" (a forma com mais
        // acentos de cada nome).
        $universidades = [];
        $guardar = function (string $u) use (&$universidades) {
            $u = trim(preg_replace('/\s+/u', ' ', $u));
            if (strlen($u) < 3) return;
            $chave = sim_sem_acento($u);
            $acentos = fn($s) => strlen($s) - strlen(sim_sem_acento($s));
            if (!isset($universidades[$chave]) || $acentos($u) > $acentos($universidades[$chave])) $universidades[$chave] = $u;
        };
        // Lista de docentes: só o que define o programa efetivo.
        $docentes = [];
        if (is_file("$dir/docentes.json")) {
            bb_json_registros("$dir/docentes.json", function (string $id, array $d) use (&$docentes, $guardar) {
                $docentes[$id] = ['ppg' => (string) ($d['ppg'] ?? ''), 'universidade' => (string) ($d['universidade'] ?? ''), 'situacao' => (string) ($d['situacao'] ?? '')];
                $guardar(doc_capitalizar($docentes[$id]['universidade']));
            });
        }
        // Posição de cada currículo no índice.
        $docs = is_file("$dir/indice/docs.bin") ? (string) file_get_contents("$dir/indice/docs.bin") : '';
        $N = intdiv(strlen($docs), BB_DOC);
        $posicao = [];
        for ($k = 0; $k < $N; $k++) $posicao[substr($docs, $k * BB_DOC, 16)] = $k;
        unset($docs);
        $marcas = array_fill(0, $N, 0);
        $instL = array_fill(0, $N, 0);
        $instP = array_fill(0, $N, 0);
        $instituicoes = ['' => 0];
        $inst = function (string $s) use (&$instituicoes): int {
            $s = trim(sim_sem_acento($s));
            return $instituicoes[$s] ??= count($instituicoes);
        };
        $totais = ['profiap' => 0, 'outro' => 0];
        $foraSituacao = ['profiap' => 0, 'outro' => 0];
        $comDados = 0;
        $buf = [];
        $n = 0;
        if (is_file("$dir/corpus.json")) {
            bb_json_registros("$dir/corpus.json", function (string $id, array $p) use (&$buf, &$marcas, &$instL, &$instP, &$totais, &$foraSituacao, &$comDados, &$n, $docentes, $posicao, $inst, $guardar, $novo, $avisar) {
                $id = vinc_id_lattes((string) ($p['id'] ?? $id)) ?: $id;
                $prog = bb_programa_efetivo($p, $docentes);
                $leve = $p;
                $leve['id'] = $id;
                $leve['programa'] = ['ppg' => $prog['ppg'], 'instituicao' => $prog['instituicao'], 'situacao' => $prog['situacao']];
                $parte = bb_parte($id);
                $buf[$parte] = ($buf[$parte] ?? '') . $id . "\t" . json_encode($leve, JSON_UNESCAPED_UNICODE) . "\n";
                if (strlen($buf[$parte]) > 32768) {
                    file_put_contents("$novo/leves/$parte.jsonl", $buf[$parte], FILE_APPEND);
                    $buf[$parte] = '';
                }
                $guardar(doc_capitalizar((string) $prog['instituicao']));
                $guardar(doc_capitalizar((string) ($p['instituicao'] ?? '')));
                $dados = trim($prog['ppg']) !== '';
                $permanente = bb_permanente($leve);
                if ($dados) {
                    $comDados++;
                    $totais[$prog['grupo']]++;
                    if (!$permanente) $foraSituacao[$prog['grupo']]++;
                }
                $k = $posicao[str_pad($id, 16, '0', STR_PAD_LEFT)] ?? null;
                if ($k !== null) {
                    $marcas[$k] = ($dados ? BB_V_DADOS : 0) | ((($p['nivel'] ?? 0) >= 5) ? BB_V_DOUTOR : 0)
                        | ($permanente ? BB_V_PERMANENTE : 0) | ($prog['grupo'] === 'profiap' ? BB_V_PROFIAP : 0);
                    $instL[$k] = $inst((string) ($p['instituicao'] ?? ''));
                    $instP[$k] = $inst((string) $prog['instituicao']);
                }
                if (++$n % 5000 === 0) $avisar("visão: $n registros");
            });
        }
        foreach ($buf as $parte => $b) if ($b !== '') file_put_contents("$novo/leves/$parte.jsonl", $b, FILE_APPEND);
        $bin = '';
        for ($k = 0; $k < $N; $k++) $bin .= pack('Cvv', $marcas[$k], $instL[$k], $instP[$k]);
        file_put_contents("$novo/docs.bin", $bin);
        ksort($universidades, SORT_STRING);
        $meta = ['assinatura' => $assinatura, 'N' => $N, 'comDados' => $comDados, 'totais' => $totais,
            'foraSituacao' => $foraSituacao, 'instituicoes' => array_keys($instituicoes),
            'universidades' => array_values($universidades), 'criadoEm' => date('c')];
        file_put_contents("$novo/meta.json", json_encode($meta, JSON_UNESCAPED_UNICODE));
        $velho = "$dir/visao.velho-" . bin2hex(random_bytes(4));
        if (is_dir("$dir/visao")) rename("$dir/visao", $velho);
        rename($novo, "$dir/visao");
        if (is_dir($velho)) bb_apagar_pasta($velho);
        bb_leve_esquecer();
        $avisar("visão pronta: $comDados currículos com dados de programa");
        return $meta;
    } finally {
        if (is_dir($novo)) bb_apagar_pasta($novo);
        flock($trava, LOCK_UN);
        fclose($trava);
    }
}
// Partes de leves/ já lidas neste processo.
function &bb_leves_lidos(): array
{
    static $partes = [];
    return $partes;
}
// Registro leve (com o programa efetivo) de um currículo do corpus, pelo ID.
function bb_leve_por_id(string $id): ?array
{
    $partes = &bb_leves_lidos();
    $id = vinc_id_lattes($id);
    if ($id === '') return null;
    $parte = bb_parte($id);
    if (!isset($partes[$parte])) {
        if (count($partes) > 64) $partes = []; // limita a memória numa busca longa
        $arq = bb_dir_dados() . "/visao/leves/$parte.jsonl";
        $partes[$parte] = "\n" . (is_file($arq) ? (string) file_get_contents($arq) : '');
    }
    $s = $partes[$parte];
    $i = strpos($s, "\n$id\t");
    if ($i === false) return null;
    $ini = $i + strlen($id) + 2;
    $fim = strpos($s, "\n", $ini);
    $p = json_decode(substr($s, $ini, ($fim === false ? strlen($s) : $fim) - $ini), true);
    return is_array($p) ? $p : null;
}
// Esquece os registros leves lidos (a visão foi refeita neste processo).
function bb_leve_esquecer(): void
{
    $partes = &bb_leves_lidos();
    $partes = [];
}

/* ------------------------------- leitura ---------------------------------- */
// Funções de leitura do índice e da visão; os arquivos de postagens são
// lidos por termo, e docs.bin (25 bytes por currículo) inteiro.
function bb_indice_abrir(): array
{
    $dir = bb_dir_dados();
    $docs = (string) @file_get_contents("$dir/indice/docs.bin");
    $visao = (string) @file_get_contents("$dir/visao/docs.bin");
    $hPost = @fopen("$dir/indice/postagens.bin", 'rb');
    return [
        'termo' => function (string $t) use ($dir, $hPost): ?array {
            $dic = "\n" . (string) @file_get_contents("$dir/indice/dic/" . bb_parte_dic($t) . '.tsv');
            $i = strpos($dic, "\n$t\t");
            if ($i === false || !$hPost) return null;
            $fim = strpos($dic, "\n", $i + 1);
            [, $idf, $pos, $n] = explode("\t", substr($dic, $i + 1, ($fim === false ? strlen($dic) : $fim) - $i - 1));
            unset($dic);
            fseek($hPost, (int) $pos);
            $pk = $n > 0 ? (string) fread($hPost, (int) $n * BB_POSTAGEM) : '';
            return [(float) $idf, $pk];
        },
        'id' => fn(int $k): string => substr($docs, $k * BB_DOC, 16),
        'comprimento' => fn(int $k): float => unpack('P', substr($docs, $k * BB_DOC + 16, 8))[1] / 10000,
        'sexo' => fn(int $k): string => trim($docs[$k * BB_DOC + 24] ?? ''),
        'visao' => function (int $k) use ($visao): ?array {
            $b = substr($visao, $k * 5, 5);
            return strlen($b) === 5 ? array_values(unpack('Cm/vl/vp', $b)) : null;
        },
    ];
}

/* -------------------------------- busca ----------------------------------- */
// Ranking da busca, na ordem exibida (sim_ordenar: proximidade com 2 casas,
// sexo feminino no empate, proximidade e nome), lido aos poucos: quem usa
// pára quando as listas estão completas. $filtros: excluirInstituicao
// (Lattes ou programa), somenteDoutores, somentePermanentes. Cada item:
// pessoa (registro leve, programa efetivo), score, termos e grupo.
function bb_buscar(array $indice, array $visao, array $consulta, array $filtros = []): Generator
{
    $ix = bb_indice_abrir();
    $excluir = trim(sim_sem_acento($filtros['excluirInstituicao'] ?? ''));
    $fora = [];
    if ($excluir !== '') foreach ($visao['instituicoes'] as $i => $s) if ($s !== '' && str_contains($s, $excluir)) $fora[$i] = true;
    $doutores = !empty($filtros['somenteDoutores']);
    $permanentes = !empty($filtros['somentePermanentes']);
    $aceita = function (int $k) use ($ix, $fora, $doutores, $permanentes): bool {
        $v = $ix['visao']($k);
        if (!$v) return false;
        [$m, $l, $p] = $v;
        return ($m & BB_V_DADOS) && (!$doutores || ($m & BB_V_DOUTOR)) && (!$permanentes || ($m & BB_V_PERMANENTE))
            && !isset($fora[$l]) && !isset($fora[$p]);
    };
    $media = (float) ($indice['media'] ?? 0);
    [$tf, $formas] = sim_consulta($consulta);
    $r = sim_pontuar_postagens($tf, $ix['termo'], $ix['comprimento'], $aceita, $media);
    if (!$r['maximo']) return;
    $ks = $sc = $r2 = $fem = [];
    foreach ($r['pontos'] as $k => $prod) {
        if ($prod <= 0) continue;
        $s = min(1.0, $prod / $r['maximo']);
        $ks[] = $k;
        $sc[] = $s;
        $r2[] = round($s, SIM_CASAS_EXIBIDAS);
        $fem[] = $ix['sexo']($k) === 'F' ? 1 : 0;
    }
    unset($r['pontos']);
    array_multisort($r2, SORT_DESC, SORT_NUMERIC, $fem, SORT_DESC, SORT_NUMERIC, $sc, SORT_DESC, SORT_NUMERIC, $ks, SORT_ASC, SORT_NUMERIC);
    $n = count($ks);
    for ($i = 0; $i < $n; $i = $j) {
        // Empate completo (mesma proximidade e sexo): ordem pelo nome.
        for ($j = $i + 1; $j < $n && $r2[$j] === $r2[$i] && $fem[$j] === $fem[$i] && $sc[$j] === $sc[$i]; $j++);
        $bloco = [];
        for ($x = $i; $x < $j; $x++) {
            $leve = bb_leve_por_id($ix['id']($ks[$x]));
            if ($leve) $bloco[] = [$ks[$x], $sc[$x], $leve];
        }
        if (count($bloco) > 1) usort($bloco, fn($a, $b) => strcmp(sim_sem_acento($a[2]['nome'] ?? ''), sim_sem_acento($b[2]['nome'] ?? '')));
        foreach ($bloco as [$k, $s, $leve]) {
            yield ['pessoa' => $leve, 'score' => $s, 'grupo' => ($ix['visao']($k)[0] & BB_V_PROFIAP) ? 'profiap' : 'outro',
                'termos' => sim_termos_comuns($r, $formas, $k, $ix['comprimento']($k), $media)];
        }
    }
}
