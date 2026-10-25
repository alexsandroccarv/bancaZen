<?php
/* ==========================================================================
   bancaZen — base do backend: pasta de dados, índice, sessão e respostas
   --------------------------------------------------------------------------
   Pasta de DADOS (privada, fora da raiz pública do site):
     - variável de ambiente BANCAZEN_DADOS, se definida no servidor web;
     - senão, o caminho gravado pelo build em lib/config-dados.php (variável
       BANCAZEN_DADOS do GitHub Actions);
     - senão, "bancazen-dados" ao lado da pasta do site (ex.: site em
       /var/www/bancazen -> dados em /var/www/bancazen-dados).
   Fica fora da pasta publicada para (1) não ser servida pelo servidor web e
   (2) não ser apagada pelo deploy (rsync --delete espelha só a pasta do site).

   Conteúdo:
     xml/<id>.xml   XML original de cada currículo (um por ID Lattes)
     corpus.json    índice leve { id: registro } só com os campos de exibição,
                    filtro e 'programa' => ['ppg', 'instituicao', 'situacao']
                    (o grupo da banca vem do PPG: bb_grupo_do_ppg)
     pessoas/<id>.json  registro completo (produções, coautores, orientações),
                    lido só quando preciso (vínculos e índice de busca)
     indice/        índice de busca (lib/indice.php): dicionário por termo e
                    postagens binárias; refeito quando o corpus.json muda
     visao/         filtros compactos e registros leves com o programa
                    efetivo; refeita quando o índice, o corpus ou a lista
                    de docentes mudam
     docentes.json  lista de docentes dos programas { id Lattes: docente }
                    (lib/docentes.php), importada de CSV, sem e-mails
     admin.json     hash da senha da administração (php api/cli/definir-senha.php)
   ========================================================================== */

// Erros do PHP (falta de memória, tempo esgotado) saem como JSON, não como
// página HTML: o navegador mostra a mensagem em vez de "erro 200".
ini_set('display_errors', '0');
// Reserva liberada no erro fatal: sem memória, a mensagem ainda é escrita.
$GLOBALS['bb_reserva'] = str_repeat(' ', 262144);
register_shutdown_function(function () {
    unset($GLOBALS['bb_reserva']);
    $e = error_get_last();
    if (!$e || !in_array($e['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) return;
    while (ob_get_level()) ob_end_clean();
    if (!headers_sent()) {
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
    }
    $msg = preg_replace('/ in \/\S+ on line \d+$/', '', $e['message']);
    if (str_contains($msg, 'Allowed memory size')) $msg = 'o servidor ficou sem memória para esta operação (memory_limit do PHP)';
    elseif (str_contains($msg, 'Maximum execution time')) $msg = 'a operação passou do tempo limite do PHP (max_execution_time)';
    echo json_encode(['erro' => "Erro no servidor: $msg."], JSON_UNESCAPED_UNICODE);
});

require_once __DIR__ . '/lattes.php';
require_once __DIR__ . '/indice.php';
require_once __DIR__ . '/similaridade.php';
require_once __DIR__ . '/vinculos.php';
require_once __DIR__ . '/docentes.php';

function bb_dir_dados(): string
{
    $env = getenv('BANCAZEN_DADOS');
    if ($env === false || $env === '') $env = $_SERVER['BANCAZEN_DADOS'] ?? '';
    if ($env === '' && is_file(__DIR__ . '/config-dados.php')) $env = (string) include __DIR__ . '/config-dados.php';
    // __DIR__ = <site>/api/lib  ->  <site>/../bancazen-dados
    $dir = $env !== '' ? $env : dirname(__DIR__, 3) . '/bancazen-dados';
    return rtrim($dir, '/');
}

function bb_preparar_dados(): string
{
    $dir = bb_dir_dados();
    foreach ([$dir, "$dir/xml"] as $d) {
        if (!is_dir($d) && !@mkdir($d, 0750, true)) {
            throw new RuntimeException("não foi possível criar a pasta de dados ($d)");
        }
    }
    // Defesa extra caso a pasta de dados acabe dentro da raiz pública (Apache).
    if (!file_exists("$dir/.htaccess")) @file_put_contents("$dir/.htaccess", "Require all denied\n");
    return $dir;
}

/* ------------------------- arquivos JSON da base ------------------------ */
function bb_carregar_json(string $nome): array
{
    $arq = bb_dir_dados() . "/$nome";
    if (!is_file($arq)) return [];
    $dados = json_decode((string) file_get_contents($arq), true);
    return is_array($dados) ? $dados : [];
}

// Executa $fn($dados) com trava exclusiva e grava os dados devolvidos.
function bb_alterar_json(string $nome, callable $fn)
{
    $dir = bb_preparar_dados();
    $trava = fopen("$dir/$nome.lock", 'c');
    flock($trava, LOCK_EX);
    try {
        [$dados, $retorno] = $fn(bb_carregar_json($nome));
        $tmp = "$dir/$nome.tmp";
        file_put_contents($tmp, json_encode($dados, JSON_UNESCAPED_UNICODE));
        rename($tmp, "$dir/$nome");
        return $retorno;
    } finally {
        flock($trava, LOCK_UN);
        fclose($trava);
    }
}

// O corpus.json é leve; uma base gravada por versões anteriores (registros
// completos) é convertida na primeira leitura (bb_migrar_corpus).
function bb_carregar_corpus(): array
{
    bb_migrar_corpus();
    return bb_carregar_json('corpus.json');
}
function bb_alterar_corpus(callable $fn)
{
    bb_migrar_corpus();
    return bb_alterar_json('corpus.json', $fn);
}

/* ------------------- registro leve e registro completo ------------------- */
const BB_CAMPOS_LEVES = ['id', 'nome', 'citacoes', 'origem', 'atualizacao', 'instituicao', 'unidade', 'cidade', 'uf',
    'titulacao', 'nivel', 'bancasMestrado', 'bancasDoutorado', 'programa', 'recebidoEm'];
function bb_leve(array $p): array
{
    return array_intersect_key($p, array_flip(BB_CAMPOS_LEVES));
}
function bb_gravar_pessoa(array $p): void
{
    $dir = bb_dir_dados() . '/pessoas';
    if (!is_dir($dir) && !@mkdir($dir, 0750, true)) throw new RuntimeException("não foi possível criar a pasta $dir");
    $id = vinc_id_lattes($p['id']);
    $tmp = "$dir/$id.json.tmp";
    file_put_contents($tmp, json_encode($p, JSON_UNESCAPED_UNICODE));
    rename($tmp, "$dir/$id.json");
}
// Registro completo de quem está no corpus ($leve). O programa vale o do
// corpus (correções na administração alteram só o registro leve). Sem o
// arquivo, ou se ele foi gravado por uma versão anterior do extrator
// (LATTES_VERSAO), relê o XML guardado e regrava o arquivo.
function bb_carregar_pessoa(array $leve): ?array
{
    $id = vinc_id_lattes((string) ($leve['id'] ?? ''));
    if ($id === '') return null;
    $dir = bb_dir_dados();
    $p = is_file("$dir/pessoas/$id.json") ? json_decode((string) file_get_contents("$dir/pessoas/$id.json"), true) : null;
    if ((!is_array($p) || ($p['versao'] ?? 1) < LATTES_VERSAO) && is_file("$dir/xml/$id.xml")) {
        try {
            $novo = lattes_ler_arquivo("$id.xml", (string) file_get_contents("$dir/xml/$id.xml"))[0]['pessoa'];
            if (vinc_id_lattes((string) $novo['id']) === $id) {
                $p = array_merge($novo, bb_leve($leve));
                bb_gravar_pessoa($p);
            }
        } catch (Throwable $e) {
            // XML ilegível: fica o registro que havia.
        }
    }
    return is_array($p) ? array_merge($p, bb_leve($leve)) : null;
}

// Base de versões anteriores: corpus.json com os registros completos, que
// pode passar do limite de memória do PHP. É lido em trechos, sem carregar o
// arquivo inteiro, e dividido em corpus.json leve + pessoas/<id>.json.
function bb_corpus_legado(): bool
{
    $arq = bb_dir_dados() . '/corpus.json';
    if (!is_file($arq)) return false;
    $h = fopen($arq, 'rb');
    $inicio = (string) fread($h, 262144);
    fclose($h);
    return (bool) preg_match('/"(producoes|resumo|orientacoes)":/', $inicio);
}
function bb_migrar_corpus(): void
{
    if (!bb_corpus_legado()) return;
    $dir = bb_preparar_dados();
    $trava = fopen("$dir/corpus.json.lock", 'c');
    flock($trava, LOCK_EX);
    try {
        if (!bb_corpus_legado()) return; // outro processo já converteu
        @set_time_limit(600);
        $leves = [];
        bb_json_registros("$dir/corpus.json", function (string $id, array $p) use (&$leves) {
            $p['id'] = vinc_id_lattes((string) ($p['id'] ?? $id)) ?: $id;
            bb_gravar_pessoa($p);
            $leves[$p['id']] = bb_leve($p);
        });
        file_put_contents("$dir/corpus.json.tmp", json_encode($leves, JSON_UNESCAPED_UNICODE));
        rename("$dir/corpus.json.tmp", "$dir/corpus.json");
    } finally {
        flock($trava, LOCK_UN);
        fclose($trava);
    }
}
// Percorre um objeto JSON { chave: objeto, ... } gravado por json_encode,
// lendo o arquivo em trechos de 1 MB: chama $fn(chave, valor) para cada par.
function bb_json_registros(string $arq, callable $fn): int
{
    $h = fopen($arq, 'rb');
    if (!$h) throw new RuntimeException('não foi possível ler ' . basename($arq));
    $buf = '';
    $mais = function () use ($h, &$buf): bool {
        $c = fread($h, 1048576);
        if ($c === false || $c === '') return false;
        $buf .= $c;
        return true;
    };
    $n = 0;
    $i = 0;
    while (($a = strpos($buf, '{', $i)) === false) { if (!$mais()) { fclose($h); return 0; } }
    $i = $a + 1;
    while (true) {
        // Próxima chave ("...") ou fim do objeto (}).
        while (($i += strcspn($buf, '"}', $i)) >= strlen($buf)) { if (!$mais()) break 2; }
        if ($buf[$i] === '}') break;
        while (($k = strpos($buf, '"', $i + 1)) === false) { if (!$mais()) break 2; }
        $chave = substr($buf, $i + 1, $k - $i - 1);
        while (($v = strpos($buf, '{', $k)) === false) { if (!$mais()) break 2; }
        // Fim do valor: conta chaves e colchetes fora de textos.
        $j = $v;
        $nivel = 0;
        $texto = false;
        while (true) {
            $len = strlen($buf);
            while ($j < $len) {
                if ($texto) {
                    $j += strcspn($buf, '"\\', $j);
                    if ($j >= $len) break;
                    if ($buf[$j] === '\\') { $j += 2; continue; }
                    $texto = false;
                    $j++;
                    continue;
                }
                $j += strcspn($buf, '"{}[]', $j);
                if ($j >= $len) break;
                $c = $buf[$j];
                if ($c === '"') $texto = true;
                elseif ($c === '{' || $c === '[') $nivel++;
                elseif (--$nivel === 0) break 2;
                $j++;
            }
            if (!$mais()) break 2;
        }
        $valor = json_decode(substr($buf, $v, $j - $v + 1), true);
        if (is_array($valor)) { $fn($chave, $valor); $n++; }
        $buf = substr($buf, $j + 1);
        $i = 0;
    }
    fclose($h);
    return $n;
}

/* --------------------------- índice de busca ----------------------------- */
// Em lib/indice.php (formato 3: dicionário por termo, postagens binárias e
// visão compacta para os filtros).

function bb_apagar_pasta(string $dir): int
{
    $n = 0;
    foreach (glob("$dir/{,.}*", GLOB_BRACE) ?: [] as $a) {
        if (in_array(basename($a), ['.', '..'], true)) continue;
        if (is_dir($a)) $n += bb_apagar_pasta($a);
        elseif (@unlink($a)) $n++;
    }
    @rmdir($dir);
    return $n;
}
function bb_carregar_docentes(): array { return bb_carregar_json('docentes.json'); }
function bb_alterar_docentes(callable $fn) { return bb_alterar_json('docentes.json', $fn); }

// Listas da banca. O grupo vem só do PPG (campo padronizado): PPG = PROFIAP
// -> Rede PROFIAP; qualquer outro PPG -> Programa externo à Rede PROFIAP.
const BB_GRUPOS = ['profiap' => 'Rede PROFIAP', 'outro' => 'Programa externo à Rede PROFIAP'];
const BB_PPG_REDE = 'PROFIAP';

function bb_grupo_do_ppg(string $ppg): string
{
    return sim_sem_acento(trim($ppg)) === sim_sem_acento(BB_PPG_REDE) ? 'profiap' : 'outro';
}

const BB_SITUACOES = ['Permanente', 'Colaborador', 'Visitante'];

// Programa informado na administração: PPG (obrigatório) e, opcionais,
// instituição e situação no programa.
// Sem PPG ($exigirPpg = false): currículo sem dados, fora da busca até a
// lista de docentes trazer a pessoa (bb_tem_dados).
function bb_programa(string $ppg, string $instituicao = '', string $situacao = '', bool $exigirPpg = true): array
{
    $ppg = trim($ppg);
    if ($ppg === '' && $exigirPpg) throw new RuntimeException('informe o PPG');
    $situacao = trim($situacao);
    if ($situacao !== '' && !in_array($situacao, BB_SITUACOES, true)) throw new RuntimeException('situação inválida');
    return ['ppg' => bb_cortar($ppg, 200), 'instituicao' => bb_cortar(trim($instituicao), 200), 'situacao' => $situacao];
}
function bb_cortar(string $s, int $n): string
{
    return function_exists('mb_substr') ? mb_substr($s, 0, $n, 'UTF-8') : substr($s, 0, $n);
}
// Programa efetivo de um currículo: se a pessoa está na lista de docentes,
// valem PPG, universidade e situação da lista; senão, os informados no envio
// do XML (sem instituição informada, vale a do endereço profissional do
// Lattes). O grupo da banca é sempre calculado do PPG; um "grupo" gravado
// por versões anteriores é ignorado.
function bb_programa_efetivo(array $p, array $docentes = []): array
{
    $d = $docentes[$p['id'] ?? ''] ?? null;
    $prog = $d
        ? ['ppg' => $d['ppg'], 'instituicao' => $d['universidade'], 'situacao' => $d['situacao'] ?? '']
        : [
            'ppg' => $p['programa']['ppg'] ?? '',
            'instituicao' => ($p['programa']['instituicao'] ?? '') !== '' ? $p['programa']['instituicao'] : ($p['instituicao'] ?? ''),
            'situacao' => $p['programa']['situacao'] ?? '',
        ];
    $prog['grupo'] = bb_grupo_do_ppg($prog['ppg']);
    return $prog;
}
// Tem dados de programa (da lista de docentes ou do envio)? Sem eles, o
// currículo fica guardado, mas fora da busca.
function bb_tem_dados(array $p, array $docentes = []): bool
{
    return trim(bb_programa_efetivo($p, $docentes)['ppg']) !== '';
}
// Docente permanente (Normas Acadêmicas do PROFIAP, 13.1)? Situação da
// lista de docentes ou dos dados gravados com o XML; sem situação, não.
function bb_permanente(array $p, array $docentes = []): bool
{
    return str_starts_with(sim_sem_acento(trim(bb_programa_efetivo($p, $docentes)['situacao'])), 'permanente');
}
function bb_grupo(array $p, array $docentes = []): string
{
    return bb_programa_efetivo($p, $docentes)['grupo'];
}

// Guarda um currículo já lido. Regra do mesmo ID: fica o de data de
// atualização mais recente (data igual: o enviado substitui o anterior).
// Devolve ['situacao' => 'novo'|'substituido'|'mantido', 'pessoa', 'anterior'].
function bb_guardar_curriculo(array &$corpus, array $pessoa, string $xmlBytes, array $programa): array
{
    $id = vinc_id_lattes($pessoa['id']);
    if ($id === '') throw new RuntimeException('currículo sem identificador Lattes (NUMERO-IDENTIFICADOR)');
    $atual = $corpus[$id] ?? null;
    if ($atual && ($atual['atualizacao'] ?? '') > ($pessoa['atualizacao'] ?? '')) {
        return ['situacao' => 'mantido', 'pessoa' => $pessoa, 'anterior' => $atual];
    }
    file_put_contents(bb_dir_dados() . "/xml/$id.xml", $xmlBytes);
    $pessoa['id'] = $id;
    $pessoa['programa'] = $programa;
    $pessoa['recebidoEm'] = date('c');
    bb_gravar_pessoa($pessoa);
    $corpus[$id] = bb_leve($pessoa);
    return ['situacao' => $atual ? 'substituido' : 'novo', 'pessoa' => $pessoa, 'anterior' => $atual];
}

// Monta ou completa o índice a partir dos XML/ZIP já guardados em
// <dados>/xml/ (por exemplo, copiados por rsync), com a regra do mesmo ID.
// Programa de cada pessoa: o já gravado no índice; senão, o da lista de
// docentes; senão, $padrao (bb_programa). Sem nenhum deles, o currículo é
// guardado sem dados (fora da busca) e listado em 'semPpg'. Com $simular, nada é gravado. 'comOutroNome'
// lista os arquivos já gravados como <ID>.xml com outro nome (cópias); com
// $organizar, são apagados depois de o índice ser gravado.
// Em lotes (Administração, limite de tempo do PHP): $limite arquivos por vez,
// em ordem de nome, a partir do primeiro depois de $depois; o relatório traz
// 'ultimo' (o $depois do próximo lote) e 'restantes'. Na simulação, 'pessoas'
// lista [id, situacao] de cada currículo, para somar os lotes sem repetir.
function bb_reindexar(?array $padrao, bool $simular = false, bool $organizar = false, string $depois = '', int $limite = 0): array
{
    $dir = bb_preparar_dados();
    $docentes = bb_carregar_docentes();
    $todos = array_values(array_filter(glob("$dir/xml/*") ?: [], fn($a) => is_file($a) && preg_match('/\.(xml|zip)$/i', $a)));
    sort($todos, SORT_STRING);
    $pendentes = $depois === '' ? $todos : array_values(array_filter($todos, fn($a) => strcmp(basename($a), $depois) > 0));
    $arquivos = $limite > 0 ? array_slice($pendentes, 0, $limite) : $pendentes;
    $rel = [
        'arquivos' => count($arquivos), 'totalArquivos' => count($todos), 'restantes' => count($pendentes) - count($arquivos),
        'ultimo' => $arquivos ? basename(end($arquivos)) : $depois,
        'novo' => 0, 'substituido' => 0, 'mantido' => 0, 'semPpg' => [], 'comOutroNome' => [], 'erros' => [], 'pessoas' => [],
    ];
    $processar = function (array $corpus) use ($arquivos, $docentes, $padrao, $simular, &$rel) {
        foreach ($arquivos as $arq) {
            $nome = basename($arq);
            $ids = [];
            try {
                foreach (lattes_ler_arquivo($nome, (string) file_get_contents($arq)) as $it) {
                    $p = $it['pessoa'];
                    $id = vinc_id_lattes($p['id']);
                    if ($id === '') throw new RuntimeException('currículo sem identificador Lattes (NUMERO-IDENTIFICADOR)');
                    $d = $docentes[$id] ?? null;
                    $programa = ($corpus[$id]['programa']['ppg'] ?? '') !== '' ? $corpus[$id]['programa']
                        : (($d['ppg'] ?? '') !== '' ? bb_programa($d['ppg'], $d['universidade'] ?? '', $d['situacao'] ?? '') : $padrao);
                    if (!$programa) {
                        $programa = bb_programa('', '', '', false);
                        $rel['semPpg'][] = ['arquivo' => $p['origem'], 'nome' => $p['nome'], 'id' => $id];
                    }
                    $ids[] = $id;
                    if ($simular) {
                        $atual = $corpus[$id] ?? null;
                        $sit = $atual && ($atual['atualizacao'] ?? '') > ($p['atualizacao'] ?? '') ? 'mantido' : ($atual ? 'substituido' : 'novo');
                        if ($sit !== 'mantido') $corpus[$id] = bb_leve(['id' => $id, 'programa' => $programa] + $p);
                        $rel['pessoas'][] = ['id' => $id, 'situacao' => $sit];
                    } else {
                        $sit = bb_guardar_curriculo($corpus, $p, $it['xml'], $programa)['situacao'];
                    }
                    $rel[$sit]++;
                }
                // Tudo do arquivo já está em <ID>.xml: o arquivo é uma cópia.
                if ($ids && (count($ids) > 1 || $nome !== "{$ids[0]}.xml")) $rel['comOutroNome'][] = $arq;
            } catch (Throwable $e) {
                $rel['erros'][] = "$nome: " . $e->getMessage();
            }
        }
        return [$corpus, count($corpus)];
    };
    if ($simular) {
        $corpus = bb_carregar_corpus();
        $rel['indiceAtual'] = count($corpus);
        $rel['total'] = $processar($corpus)[1];
    } else {
        $rel['total'] = bb_alterar_corpus($processar);
    }
    $rel['organizados'] = 0;
    if ($organizar && !$simular) {
        foreach ($rel['comOutroNome'] as $arq) $rel['organizados'] += (int) @unlink($arq);
    }
    $rel['comOutroNome'] = array_map('basename', $rel['comOutroNome']);
    return $rel;
}

// Zona de risco da Administração: apaga os currículos (corpus, registros
// completos, índice de busca e todos os arquivos de <dados>/xml/) e/ou a
// lista de docentes, com as travas de gravação. A senha (admin.json) fica.
// Devolve o que foi apagado.
function bb_limpar(bool $curriculos, bool $docentes): array
{
    $dir = bb_preparar_dados();
    $rel = ['curriculos' => 0, 'arquivos' => 0, 'docentes' => 0];
    if ($curriculos) {
        $rel['curriculos'] = bb_alterar_corpus(function (array $corpus) use ($dir, &$rel) {
            foreach (glob("$dir/xml/*") ?: [] as $arq) {
                if (is_file($arq) && @unlink($arq)) $rel['arquivos']++;
            }
            bb_apagar_pasta("$dir/pessoas");
            bb_apagar_pasta("$dir/indice");
            bb_apagar_pasta("$dir/visao");
            return [[], count($corpus)];
        });
    }
    if ($docentes) {
        $rel['docentes'] = bb_alterar_docentes(fn(array $d) => [[], count($d)]);
    }
    return $rel;
}

// Campos que podem sair do servidor (nada de produções, coautores ou XML).
// Exibição: Nome, Universidade, PPG, Situação no programa e Link do Lattes.
function bb_publico(array $p, array $docentes = []): array
{
    $prog = bb_programa_efetivo($p, $docentes);
    return [
        'id' => $p['id'], 'nome' => $p['nome'], 'titulacao' => $p['titulacao'] ?? '',
        'instituicao' => $p['instituicao'] ?? '', 'uf' => $p['uf'] ?? '',
        'bancasMestrado' => $p['bancasMestrado'] ?? 0, 'atualizacao' => $p['atualizacao'] ?? '',
        'ppg' => $prog['ppg'], 'universidade' => $prog['instituicao'], 'situacao' => $prog['situacao'],
    ];
}

/* ------------------------------- respostas ------------------------------- */
function bb_json($dados, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($dados, JSON_UNESCAPED_UNICODE);
    exit;
}
function bb_erro(string $msg, int $status = 400): void
{
    bb_json(['erro' => $msg], $status);
}
function bb_exigir_metodo(string $metodo): void
{
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== $metodo) bb_erro('Método não permitido.', 405);
}

/* -------------------------------- sessão --------------------------------- */
function bb_sessao(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) return;
    session_name('bb_admin');
    session_set_cookie_params([
        'path' => '/', 'httponly' => true, 'samesite' => 'Strict',
        'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
    ]);
    session_start();
}
function bb_hash_senha(): string
{
    $arq = bb_dir_dados() . '/admin.json';
    $cfg = is_file($arq) ? json_decode((string) file_get_contents($arq), true) : null;
    return is_array($cfg) ? (string) ($cfg['hash'] ?? '') : '';
}
function bb_admin_logado(): bool
{
    bb_sessao();
    return !empty($_SESSION['admin']);
}
// Ações que alteram dados exigem sessão e o token anti-CSRF (cabeçalho X-CSRF).
function bb_exigir_admin(): void
{
    if (!bb_admin_logado()) bb_erro('Sessão expirada. Entre de novo.', 401);
    $token = $_SERVER['HTTP_X_CSRF'] ?? '';
    if (!hash_equals((string) ($_SESSION['csrf'] ?? ''), (string) $token)) bb_erro('Token inválido. Recarregue a página.', 403);
}
