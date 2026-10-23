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
     corpus.json    índice processado { id: registro }; cada registro leva
                    'programa' => ['ppg', 'instituicao', 'situacao'] (o grupo da
                    banca vem do PPG: bb_grupo_do_ppg)
     docentes.json  lista de docentes dos programas { id Lattes: docente }
                    (lib/docentes.php), importada de CSV, sem e-mails
     admin.json     hash da senha da administração (php api/cli/definir-senha.php)
   ========================================================================== */

require_once __DIR__ . '/lattes.php';
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

function bb_carregar_corpus(): array { return bb_carregar_json('corpus.json'); }
function bb_alterar_corpus(callable $fn) { return bb_alterar_json('corpus.json', $fn); }
function bb_carregar_docentes(): array { return bb_carregar_json('docentes.json'); }
function bb_alterar_docentes(callable $fn) { return bb_alterar_json('docentes.json', $fn); }

// Listas da banca. O grupo vem só do PPG (campo padronizado): PPG = PROFIAP
// -> Rede PROFIAP; qualquer outro PPG -> Externa.
const BB_GRUPOS = ['profiap' => 'Rede PROFIAP', 'outro' => 'Externa'];
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
    $corpus[$id] = $pessoa;
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
                        if ($sit !== 'mantido') $corpus[$id] = ['id' => $id, 'programa' => $programa] + $p;
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
