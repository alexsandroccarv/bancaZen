<?php
/* ==========================================================================
   bancaZen — Lista de docentes dos programas (importação de CSV)
   --------------------------------------------------------------------------
   A lista diz quem é docente de qual PPG, com universidade e situação no
   programa (Permanente, Colaborador, Visitante), e pode ser importada antes
   dos XMLs do Lattes. Quando a pessoa está na lista, os dados da lista valem
   para a exibição e para separar as listas de sugestões pelo PPG (Rede
   PROFIAP ou Externa: bb_programa_efetivo e bb_grupo_do_ppg, em base.php).

   Formato aceito (ex.: a planilha "docentes PROFIAP 2025"): CSV separado por
   ";" ou ",", com ou sem BOM, com cabeçalho. Colunas reconhecidas:
     nome                                    obrigatória
     lattes_id ou lattes_url (ou lattes)     obrigatória (16 dígitos)
     universidade_normalizada ou universidade (ou instituicao)
     categoria_normalizada ou categoria (ou situacao)
     ppg                                     opcional (senão, o PPG do envio)
   Qualquer outra coluna, como e-mail, é DESCARTADA: a lista guarda só o que
   é exibido.
   ========================================================================== */

// ID Lattes das linhas de exemplo do modelo: ignorado na importação.
const DOC_ID_EXEMPLO = '0000000000000000';

// Modelo do arquivo CSV oferecido na Administração: separado por ";", em
// UTF-8 com BOM (abre direto no Excel em português), com cabeçalho e duas
// linhas de exemplo fictícias (ID Lattes DOC_ID_EXEMPLO).
function doc_modelo_csv(): string
{
    $linhas = [
        ['nome', 'lattes_id', 'universidade', 'categoria', 'ppg'],
        ['Maria Exemplo da Silva', DOC_ID_EXEMPLO, 'Universidade Federal Exemplo', 'Permanente', 'PROFIAP'],
        ['João Modelo Pereira', DOC_ID_EXEMPLO, 'Universidade Estadual Modelo', 'Colaborador', 'PROFIAP'],
    ];
    return "\xEF\xBB\xBF" . implode("\r\n", array_map(fn($l) => implode(';', $l), $linhas)) . "\r\n";
}

// Prioridade quando a mesma pessoa aparece mais de uma vez.
const DOC_PRIORIDADE = ['Permanente' => 3, 'Colaborador' => 2, 'Visitante' => 1];
const DOC_MINUSCULAS = ['de', 'da', 'do', 'das', 'dos', 'e', 'del', 'di', 'du', 'em', 'na', 'no'];

// "UNIVERSIDADE FEDERAL DO PAMPA" -> "Universidade Federal do Pampa".
// Textos que já têm minúsculas ficam como estão.
function doc_capitalizar(string $s): string
{
    $s = trim(preg_replace('/\s+/u', ' ', $s));
    if ($s === '' || !function_exists('mb_strtolower') || mb_strtoupper($s, 'UTF-8') !== $s) return $s;
    $palavras = explode(' ', mb_strtolower($s, 'UTF-8'));
    foreach ($palavras as $i => $w) {
        if ($i > 0 && in_array($w, DOC_MINUSCULAS, true)) continue;
        // Hífens: "afro-brasileira" -> "Afro-Brasileira".
        $palavras[$i] = implode('-', array_map(fn($x) => mb_strtoupper(mb_substr($x, 0, 1, 'UTF-8'), 'UTF-8') . mb_substr($x, 1, null, 'UTF-8'), explode('-', $w)));
    }
    return implode(' ', $palavras);
}

function doc_situacao(string $s): string
{
    $t = sim_sem_acento(trim($s));
    foreach (array_keys(DOC_PRIORIDADE) as $sit) if (str_starts_with($t, sim_sem_acento($sit))) return $sit;
    return '';
}

// Entre dois registros da mesma pessoa, fica o de maior prioridade; o nome
// com acentuação (mais informativo) é preferido.
function doc_mesclar(array $a, array $b): array
{
    $pa = DOC_PRIORIDADE[$a['situacao']] ?? 0;
    $pb = DOC_PRIORIDADE[$b['situacao']] ?? 0;
    $m = $pb > $pa ? $b : $a;
    $acentos = fn($n) => strlen($n) - strlen(sim_sem_acento($n));
    $m['nome'] = $acentos($b['nome']) > $acentos($a['nome']) ? $b['nome'] : $a['nome'];
    return $m;
}

// Lê o CSV e devolve [docentes por id, relatório].
// $padrao = ['ppg' => ...] (PPG usado quando a linha não tem a coluna ppg).
function doc_ler_csv(string $conteudo, array $padrao): array
{
    $conteudo = preg_replace('/^\xEF\xBB\xBF/', '', $conteudo);
    if (!preg_match('//u', $conteudo)) $conteudo = lattes_latin1($conteudo); // planilha salva em Latin-1
    $linhas = preg_split('/\r\n|\r|\n/', $conteudo);
    $cab = array_shift($linhas) ?? '';
    $sep = substr_count($cab, ';') >= substr_count($cab, ',') ? ';' : ',';
    $colunas = array_map(fn($c) => sim_sem_acento(trim($c)), str_getcsv($cab, $sep, '"', ''));
    $col = function (array $nomes) use ($colunas) {
        foreach ($nomes as $n) { $i = array_search($n, $colunas, true); if ($i !== false) return $i; }
        return null;
    };
    $iNome = $col(['nome', 'docente']);
    $iLattes = $col(['lattes_id', 'lattes_url', 'lattes', 'id_lattes']);
    $iUniv = $col(['universidade_normalizada', 'universidade', 'instituicao', 'ies']);
    $iSit = $col(['categoria_normalizada', 'categoria', 'situacao']);
    $iPpg = $col(['ppg', 'programa']);
    if ($iNome === null || $iLattes === null) {
        throw new RuntimeException('o CSV precisa das colunas "nome" e "lattes_id" (ou "lattes_url")');
    }

    // Colunas que não são guardadas (ex.: e-mail), informadas no relatório.
    $usadas = array_filter([$iNome, $iLattes, $iUniv, $iSit, $iPpg], fn($i) => $i !== null);
    $descartadas = array_values(array_diff_key($colunas, array_flip($usadas)));

    $docentes = [];
    $rel = ['linhas' => 0, 'importados' => 0, 'duplicados' => 0, 'semLattes' => [], 'semSituacao' => 0, 'exemplos' => 0,
            'colunasDescartadas' => $descartadas];
    foreach ($linhas as $linha) {
        if (trim($linha) === '') continue;
        $c = str_getcsv($linha, $sep, '"', '');
        $rel['linhas']++;
        $nome = doc_capitalizar((string) ($c[$iNome] ?? ''));
        $id = vinc_id_lattes(preg_match('/\d{16}/', (string) ($c[$iLattes] ?? ''), $m) ? $m[0] : '');
        if ($id === '') { $rel['semLattes'][] = $nome !== '' ? $nome : "linha {$rel['linhas']}"; continue; }
        if ($id === DOC_ID_EXEMPLO) { $rel['exemplos']++; continue; } // linha de exemplo do modelo
        $situacao = $iSit !== null ? doc_situacao((string) ($c[$iSit] ?? '')) : '';
        if ($situacao === '') $rel['semSituacao']++;
        $ppg = $iPpg !== null ? trim((string) ($c[$iPpg] ?? '')) : '';
        $d = [
            'id' => $id, 'nome' => $nome,
            'universidade' => $iUniv !== null ? doc_capitalizar((string) ($c[$iUniv] ?? '')) : '',
            'ppg' => $ppg !== '' ? $ppg : $padrao['ppg'], 'situacao' => $situacao,
        ];
        if (isset($docentes[$id])) { $rel['duplicados']++; $docentes[$id] = doc_mesclar($docentes[$id], $d); }
        else $docentes[$id] = $d;
    }
    $rel['importados'] = count($docentes);
    return [$docentes, $rel];
}

// Junta a lista importada à atual. Com $substituir, quem era do mesmo PPG e
// não está no arquivo novo sai da lista (atualização anual).
function doc_aplicar(array $atuais, array $novos, string $ppg, bool $substituir): array
{
    $removidos = 0;
    if ($substituir) {
        $alvo = sim_sem_acento($ppg);
        foreach ($atuais as $id => $d) {
            if (sim_sem_acento($d['ppg']) === $alvo && !isset($novos[$id])) { unset($atuais[$id]); $removidos++; }
        }
    }
    $atualizados = count(array_intersect_key($novos, $atuais));
    $agora = date('c');
    foreach ($novos as $id => $d) $atuais[$id] = $d + ['importadoEm' => $agora];
    return [$atuais, ['atualizados' => $atualizados, 'novos' => count($novos) - $atualizados, 'removidos' => $removidos]];
}
