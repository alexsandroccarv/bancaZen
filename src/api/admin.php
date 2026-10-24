<?php
/* ==========================================================================
   bancaZen — api/admin.php?acao=...  (área de administração)
   --------------------------------------------------------------------------
     GET  sessao     -> { logado, configurado, csrf }
     POST entrar     senha
     POST sair
     GET  listar     -> currículos da base (campos de exibição + programa)
     POST enviar     arquivos[] (XML/ZIP); ppg, instituicao, situacao opcionais
                     (os dados vêm da lista de docentes; sem eles, o currículo
                     fica sem dados, fora da busca)
     POST programa   id, ppg, instituicao, situacao   (corrige o programa)
     GET  docentes   -> lista de docentes dos programas, com currículo enviado ou não
     POST importar-docentes   arquivo (CSV); ppg (padrão das linhas sem a coluna,
                              senão PROFIAP) e substituir (padrão 1) opcionais
   O grupo da banca (Rede PROFIAP ou Programa externo à Rede PROFIAP) vem do PPG: bb_grupo_do_ppg.
     GET  modelo-docentes     -> modelo do CSV da lista de docentes (download;
                                 sem dados da base, não exige sessão)
     POST remover    id
     POST indexar    -> refaz o índice de busca, se a base mudou (bb_indice_garantir)
     POST limpar     curriculos (1/0), docentes (1/0), confirmacao = LIMPAR
                     -> apaga índice e arquivos de <dados>/xml/ e/ou a lista
                     de docentes (bb_limpar); a senha fica
     POST reindexar  ppg, instituicao, situacao, simular (1/0), organizar (1/0),
                     depois  -> um lote dos XML/ZIP de <dados>/xml/ (copiados
                     por rsync/FTP) no índice; repetir com depois = ultimo
                     enquanto restantes > 0 (bb_reindexar)
   Todas as ações, exceto sessao e entrar, exigem sessão; as que alteram
   dados exigem também o token anti-CSRF no cabeçalho X-CSRF.
   A senha é definida no servidor: php api/cli/definir-senha.php
   ========================================================================== */
require_once __DIR__ . '/lib/base.php';

$acao = $_GET['acao'] ?? '';
// Arquivos por requisição em "reindexar" (limite de tempo do PHP).
const BB_LOTE_REINDEXAR = 25;
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
                'grupo' => bb_grupo($p, $docentes), 'naLista' => isset($docentes[$p['id']]), 'semDados' => !bb_tem_dados($p, $docentes), 'recebidoEm' => $p['recebidoEm'] ?? '', 'origem' => $p['origem'] ?? '',
            ], array_values(bb_carregar_corpus()));
            usort($lista, fn($a, $b) => strcmp(sim_sem_acento($a['nome']), sim_sem_acento($b['nome'])));
            bb_json(['curriculos' => $lista]);

        case 'enviar':
            bb_exigir_metodo('POST');
            bb_exigir_admin();
            $programa = bb_programa($post('ppg'), $post('instituicao'), $post('situacao'), false);
            $arquivos = $_FILES['arquivos'] ?? null;
            if (!$arquivos || !is_array($arquivos['name'])) bb_erro('Nenhum arquivo recebido.');
            $docentes = bb_carregar_docentes();
            $relatorio = bb_alterar_corpus(function (array $corpus) use ($arquivos, $programa, $docentes) {
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
                                'semDados' => !bb_tem_dados($r['pessoa'], $docentes),
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
            $programa = bb_programa($post('ppg'), $post('instituicao'), $post('situacao'));
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
            // O grupo calculado do PPG prevalece sobre um "grupo" gravado antes.
            $lista = array_map(fn($d) => ['temCurriculo' => isset($corpus[$d['id']]), 'grupo' => bb_grupo_do_ppg($d['ppg'])] + $d, array_values(bb_carregar_docentes()));
            usort($lista, fn($a, $b) => strcmp(sim_sem_acento($a['nome']), sim_sem_acento($b['nome'])));
            bb_json(['docentes' => $lista]);

        case 'modelo-docentes':
            bb_exigir_metodo('GET');
            header('Content-Type: text/csv; charset=utf-8');
            header('Content-Disposition: attachment; filename="modelo-docentes-bancazen.csv"');
            header('Cache-Control: no-store');
            header('X-Content-Type-Options: nosniff');
            echo doc_modelo_csv();
            exit;

        case 'importar-docentes':
            bb_exigir_metodo('POST');
            bb_exigir_admin();
            $ppg = $post('ppg') !== '' ? $post('ppg') : BB_PPG_REDE;
            $arq = $_FILES['arquivo'] ?? null;
            if (!$arq || ($arq['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) bb_erro('Nenhum arquivo CSV recebido.');
            [$novos, $rel] = doc_ler_csv((string) file_get_contents($arq['tmp_name']), ['ppg' => bb_cortar($ppg, 200)]);
            if (!$novos) bb_erro($rel['exemplos'] && !$rel['semLattes']
                ? 'O arquivo só tem as linhas de exemplo do modelo: substitua-as pelos docentes do programa (com o ID Lattes de cada um).'
                : 'Nenhum docente com Lattes encontrado no arquivo.');
            $rel += bb_alterar_docentes(fn($atuais) => doc_aplicar($atuais, $novos, $post('substituir') !== '0'));
            bb_json(['relatorio' => $rel]);

        case 'reindexar':
            bb_exigir_metodo('POST');
            bb_exigir_admin();
            @set_time_limit(300);
            @ini_set('memory_limit', '1024M');
            $padrao = $post('ppg') !== '' ? bb_programa($post('ppg'), $post('instituicao'), $post('situacao')) : null;
            $simular = $post('simular') === '1';
            bb_json(['relatorio' => bb_reindexar($padrao, $simular, !$simular && $post('organizar') === '1', $post('depois'), BB_LOTE_REINDEXAR)]);

        case 'indexar':
            bb_exigir_metodo('POST');
            bb_exigir_admin();
            @ini_set('memory_limit', '512M');
            $meta = bb_indice_garantir();
            bb_json(['curriculos' => $meta['N'], 'criadoEm' => $meta['criadoEm']]);

        case 'limpar':
            bb_exigir_metodo('POST');
            bb_exigir_admin();
            if ($post('confirmacao') !== 'LIMPAR') bb_erro('Digite LIMPAR para confirmar.');
            $curriculos = $post('curriculos') === '1';
            $docentes = $post('docentes') === '1';
            if (!$curriculos && !$docentes) bb_erro('Escolha o que apagar.');
            @set_time_limit(120);
            bb_json(['relatorio' => bb_limpar($curriculos, $docentes)]);

        case 'remover':
            bb_exigir_metodo('POST');
            bb_exigir_admin();
            $id = vinc_id_lattes($post('id'));
            bb_alterar_corpus(function (array $corpus) use ($id) {
                if (!isset($corpus[$id])) throw new RuntimeException('currículo não encontrado');
                unset($corpus[$id]);
                @unlink(bb_dir_dados() . "/xml/$id.xml");
                @unlink(bb_dir_dados() . "/pessoas/$id.json");
                return [$corpus, null];
            });
            bb_json(['ok' => true]);

        default:
            bb_erro('Ação desconhecida.', 404);
    }
} catch (Throwable $e) {
    bb_erro($e->getMessage());
}
