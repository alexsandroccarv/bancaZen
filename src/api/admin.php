<?php
/* ==========================================================================
   bancaZen — api/admin.php?acao=...  (área de administração)
   --------------------------------------------------------------------------
     GET  sessao     -> { logado, configurado, csrf }
     POST entrar     senha
     POST sair
     GET  listar     -> currículos da base (campos de exibição + programa)
     POST enviar     arquivos[] (XML/ZIP), grupo, ppg, instituicao, situacao
     POST programa   id, grupo, ppg, instituicao, situacao   (corrige o programa)
     GET  docentes   -> lista de docentes dos programas, com currículo enviado ou não
     POST importar-docentes   arquivo (CSV), grupo, ppg, substituir (1/0)
     POST remover    id
   Todas as ações, exceto sessao e entrar, exigem sessão; as que alteram
   dados exigem também o token anti-CSRF no cabeçalho X-CSRF.
   A senha é definida no servidor: php api/cli/definir-senha.php
   ========================================================================== */
require_once __DIR__ . '/lib/base.php';

$acao = $_GET['acao'] ?? '';
$post = fn($k) => trim((string) ($_POST[$k] ?? ''));

try {
    switch ($acao) {
        case 'sessao':
            bb_exigir_metodo('GET');
            $logado = bb_admin_logado();
            bb_json(['logado' => $logado, 'configurado' => bb_hash_senha() !== '', 'csrf' => $logado ? $_SESSION['csrf'] : null]);

        case 'entrar':
            bb_exigir_metodo('POST');
            bb_sessao();
            $hash = bb_hash_senha();
            if ($hash === '') bb_erro('Senha da administração ainda não definida no servidor (php api/cli/definir-senha.php).', 503);
            if (!password_verify($post('senha'), $hash)) {
                sleep(2); // atrasa tentativas por força bruta
                bb_erro('Senha incorreta.', 401);
            }
            session_regenerate_id(true);
            $_SESSION['admin'] = true;
            $_SESSION['csrf'] = bin2hex(random_bytes(32));
            bb_json(['logado' => true, 'csrf' => $_SESSION['csrf']]);

        case 'sair':
            bb_exigir_metodo('POST');
            bb_exigir_admin();
            $_SESSION = [];
            session_destroy();
            bb_json(['logado' => false]);

        case 'listar':
            bb_exigir_metodo('GET');
            if (!bb_admin_logado()) bb_erro('Sessão expirada. Entre de novo.', 401);
            $docentes = bb_carregar_docentes();
            $lista = array_map(fn($p) => bb_publico($p, $docentes) + [
                'grupo' => bb_grupo($p, $docentes), 'naLista' => isset($docentes[$p['id']]), 'recebidoEm' => $p['recebidoEm'] ?? '', 'origem' => $p['origem'] ?? '',
            ], array_values(bb_carregar_corpus()));
            usort($lista, fn($a, $b) => strcmp(sim_sem_acento($a['nome']), sim_sem_acento($b['nome'])));
            bb_json(['curriculos' => $lista]);

        case 'enviar':
            bb_exigir_metodo('POST');
            bb_exigir_admin();
            $programa = bb_programa($post('grupo'), $post('ppg'), $post('instituicao'), $post('situacao'));
            $arquivos = $_FILES['arquivos'] ?? null;
            if (!$arquivos || !is_array($arquivos['name'])) bb_erro('Nenhum arquivo recebido.');
            $relatorio = bb_alterar_corpus(function (array $corpus) use ($arquivos, $programa) {
                $rel = [];
                foreach ($arquivos['name'] as $i => $nome) {
                    if ($arquivos['error'][$i] !== UPLOAD_ERR_OK) {
                        $rel[] = ['arquivo' => $nome, 'situacao' => 'erro', 'mensagem' => 'falha no envio (código ' . $arquivos['error'][$i] . '; verifique upload_max_filesize)'];
                        continue;
                    }
                    if (!preg_match('/\.(xml|zip)$/i', $nome)) continue;
                    try {
                        foreach (lattes_ler_arquivo($nome, (string) file_get_contents($arquivos['tmp_name'][$i])) as $it) {
                            $r = bb_guardar_curriculo($corpus, $it['pessoa'], $it['xml'], $programa);
                            $rel[] = [
                                'arquivo' => $it['pessoa']['origem'], 'situacao' => $r['situacao'],
                                'nome' => $it['pessoa']['nome'], 'id' => $it['pessoa']['id'],
                                'atualizacao' => $it['pessoa']['atualizacao'],
                                'atualizacaoAnterior' => $r['anterior']['atualizacao'] ?? '',
                            ];
                        }
                    } catch (Throwable $e) {
                        $rel[] = ['arquivo' => $nome, 'situacao' => 'erro', 'mensagem' => $e->getMessage()];
                    }
                }
                return [$corpus, $rel];
            });
            bb_json(['relatorio' => $relatorio]);

        case 'programa':
            bb_exigir_metodo('POST');
            bb_exigir_admin();
            $programa = bb_programa($post('grupo'), $post('ppg'), $post('instituicao'), $post('situacao'));
            $id = vinc_id_lattes($post('id'));
            bb_alterar_corpus(function (array $corpus) use ($id, $programa) {
                if (!isset($corpus[$id])) throw new RuntimeException('currículo não encontrado');
                $corpus[$id]['programa'] = $programa;
                return [$corpus, null];
            });
            bb_json(['ok' => true]);

        case 'docentes':
            bb_exigir_metodo('GET');
            if (!bb_admin_logado()) bb_erro('Sessão expirada. Entre de novo.', 401);
            $corpus = bb_carregar_corpus();
            $lista = array_map(fn($d) => $d + ['temCurriculo' => isset($corpus[$d['id']])], array_values(bb_carregar_docentes()));
            usort($lista, fn($a, $b) => strcmp(sim_sem_acento($a['nome']), sim_sem_acento($b['nome'])));
            bb_json(['docentes' => $lista]);

        case 'importar-docentes':
            bb_exigir_metodo('POST');
            bb_exigir_admin();
            $grupo = $post('grupo');
            if (!isset(BB_GRUPOS[$grupo])) bb_erro('Grupo inválido.');
            $ppg = $post('ppg') !== '' ? $post('ppg') : ($grupo === 'profiap' ? 'PROFIAP' : '');
            if ($ppg === '') bb_erro('Informe o PPG.');
            $arq = $_FILES['arquivo'] ?? null;
            if (!$arq || ($arq['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) bb_erro('Nenhum arquivo CSV recebido.');
            [$novos, $rel] = doc_ler_csv((string) file_get_contents($arq['tmp_name']), ['grupo' => $grupo, 'ppg' => bb_cortar($ppg, 200)]);
            if (!$novos) bb_erro('Nenhum docente com Lattes encontrado no arquivo.');
            $rel += bb_alterar_docentes(fn($atuais) => doc_aplicar($atuais, $novos, $ppg, $post('substituir') === '1'));
            bb_json(['relatorio' => $rel]);

        case 'remover':
            bb_exigir_metodo('POST');
            bb_exigir_admin();
            $id = vinc_id_lattes($post('id'));
            bb_alterar_corpus(function (array $corpus) use ($id) {
                if (!isset($corpus[$id])) throw new RuntimeException('currículo não encontrado');
                unset($corpus[$id]);
                @unlink(bb_dir_dados() . "/xml/$id.xml");
                return [$corpus, null];
            });
            bb_json(['ok' => true]);

        default:
            bb_erro('Ação desconhecida.', 404);
    }
} catch (Throwable $e) {
    bb_erro($e->getMessage());
}
