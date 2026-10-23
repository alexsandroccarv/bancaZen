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
   ";", "," ou tabulação, com ou sem BOM, com cabeçalho (maiúsculas, acentos,
   espaços e hífens no nome da coluna não importam). Colunas reconhecidas:
     nome                                    obrigatória
     lattes_id e/ou lattes_url (ou lattes)   obrigatória: o ID (16 dígitos) ou
                                             o link http(s)://lattes.cnpq.br/ID;
                                             com as duas colunas, se divergirem,
                                             vale o link (o Excel arredonda
                                             números de 16 dígitos)
     universidade_normalizada ou universidade (ou instituicao)
     categoria_normalizada ou categoria (ou situacao)
     ppg                                     opcional (senão, PROFIAP)
     email (ou e-mail)                       opcional (inválido é ignorado)
   Qualquer outra coluna é DESCARTADA. O e-mail fica só na lista (pasta de
   dados privada) e só aparece na Administração; nunca nas respostas
   públicas (bb_publico).
   ========================================================================== */

// ID Lattes das linhas de exemplo do modelo: ignorado na importação.
const DOC_ID_EXEMPLO = '0000000000000000';

// Modelo do arquivo CSV oferecido na Administração: separado por ";", em
// UTF-8 com BOM (abre direto no Excel em português), com cabeçalho e duas
// linhas de exemplo fictícias (ID Lattes DOC_ID_EXEMPLO).
function doc_modelo_csv(): string
{
    $linhas = [
        ['nome', 'lattes_id', 'universidade', 'categoria', 'ppg', 'email'],
        ['Maria Exemplo da Silva', DOC_ID_EXEMPLO, 'Universidade Federal Exemplo', 'Permanente', 'PROFIAP', 'maria@exemplo.br'],
        ['João Modelo Pereira', DOC_ID_EXEMPLO, 'Universidade Estadual Modelo', 'Colaborador', 'PROFIAP', ''],
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
// com acentuação (mais informativo) é preferido; sem e-mail, vale o do outro.
function doc_mesclar(array $a, array $b): array
{
    $pa = DOC_PRIORIDADE[$a['situacao']] ?? 0;
    $pb = DOC_PRIORIDADE[$b['situacao']] ?? 0;
    $m = $pb > $pa ? $b : $a;
    $acentos = fn($n) => strlen($n) - strlen(sim_sem_acento($n));
    $m['nome'] = $acentos($b['nome']) > $acentos($a['nome']) ? $b['nome'] : $a['nome'];
    if (($m['email'] ?? '') === '') $m['email'] = ($a['email'] ?? '') !== '' ? $a['email'] : ($b['email'] ?? '');
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
    // Separador mais frequente no cabeçalho (empate: ";").
    $sep = ';';
    $max = 0;
    foreach ([';', ',', "\t"] as $c) {
        $n = substr_count($cab, $c);
        if ($n > $max) { $max = $n; $sep = $c; }
    }
    // "ID Lattes", "Link do Lattes", "lattes-url" -> id_lattes, link_do_lattes, lattes_url.
    $colunas = array_map(fn($c) => trim(preg_replace('/[^a-z0-9]+/', '_', sim_sem_acento(trim($c))), '_'), str_getcsv($cab, $sep, '"', ''));
    $col = function (array $nomes) use ($colunas) {
        foreach ($nomes as $n) { $i = array_search($n, $colunas, true); if ($i !== false) return $i; }
        return null;
    };
    $iNome = $col(['nome', 'docente', 'nome_completo']);
    // Todas as colunas de Lattes: o link vem antes do número, porque o Excel
    // arredonda números de 16 dígitos (último dígito vira 0).
    $iLinks = array_values(array_filter(array_map(fn($n) => $col([$n]), ['lattes_url', 'url_lattes', 'link_lattes', 'link_do_lattes', 'curriculo_lattes', 'lattes']), fn($i) => $i !== null));
    $iIds = array_values(array_filter(array_map(fn($n) => $col([$n]), ['lattes_id', 'id_lattes', 'id_do_lattes', 'numero_lattes']), fn($i) => $i !== null));
    $iLattesTodas = array_values(array_unique(array_merge($iLinks, $iIds)));
    $iLattes = $iLattesTodas[0] ?? null;
    $iUniv = $col(['universidade_normalizada', 'universidade', 'instituicao', 'ies']);
    $iSit = $col(['categoria_normalizada', 'categoria', 'situacao']);
    $iPpg = $col(['ppg', 'programa']);
    $iEmail = $col(['email', 'e_mail', 'correio_eletronico']);
    if ($iNome === null || $iLattes === null) {
        throw new RuntimeException('o CSV precisa das colunas "nome" e "lattes_id" (ou "lattes_url")');
    }

    // Colunas que não são guardadas (ex.: e-mail), informadas no relatório.
    $usadas = array_filter(array_merge([$iNome, $iUniv, $iSit, $iPpg, $iEmail], $iLattesTodas), fn($i) => $i !== null);
    $descartadas = array_values(array_diff_key($colunas, array_flip($usadas)));

    $docentes = [];
    $rel = ['linhas' => 0, 'importados' => 0, 'duplicados' => 0, 'semLattes' => [], 'semSituacao' => 0, 'exemplos' => 0, 'ppgPadrao' => 0, 'emailInvalido' => 0, 'idDivergente' => [], 'idCientifico' => [],
            'colunasDescartadas' => $descartadas];
    foreach ($linhas as $linha) {
        if (trim($linha) === '') continue;
        $c = str_getcsv($linha, $sep, '"', '');
        $rel['linhas']++;
        $nome = doc_capitalizar((string) ($c[$iNome] ?? ''));
        // ID de cada coluna de Lattes: 16 dígitos sozinhos ou no link.
        $ids = [];
        $cientifico = false;
        foreach ($iLattesTodas as $i) {
            $v = trim((string) ($c[$i] ?? ''));
            if (preg_match('/(?<!\d)\d{16}(?!\d)/', $v, $m)) $ids[] = $m[0];
            elseif (preg_match('/^\d+([.,]\d+)?e\+?\d+$/i', $v)) $cientifico = true;
        }
        $ids = array_values(array_unique($ids));
        $rotulo = $nome !== '' ? $nome : "linha {$rel['linhas']}";
        if (count($ids) > 1) $rel['idDivergente'][] = "$rotulo (" . implode(' x ', $ids) . "; vale {$ids[0]})";
        $id = vinc_id_lattes($ids[0] ?? '');
        if ($id === '') {
            if ($cientifico) $rel['idCientifico'][] = $rotulo;
            $rel['semLattes'][] = $rotulo;
            continue;
        }
        if ($id === DOC_ID_EXEMPLO) { $rel['exemplos']++; continue; } // linha de exemplo do modelo
        $situacao = $iSit !== null ? doc_situacao((string) ($c[$iSit] ?? '')) : '';
        if ($situacao === '') $rel['semSituacao']++;
        $ppg = $iPpg !== null ? trim((string) ($c[$iPpg] ?? '')) : '';
        if ($ppg === '') $rel['ppgPadrao']++;
        $email = $iEmail !== null ? strtolower(trim((string) ($c[$iEmail] ?? ''))) : '';
        if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) { $rel['emailInvalido']++; $email = ''; }
        $d = [
            'id' => $id, 'nome' => $nome,
            'universidade' => $iUniv !== null ? doc_capitalizar((string) ($c[$iUniv] ?? '')) : '',
            'ppg' => $ppg !== '' ? $ppg : $padrao['ppg'], 'situacao' => $situacao, 'email' => $email,
        ];
        if (isset($docentes[$id])) { $rel['duplicados']++; $docentes[$id] = doc_mesclar($docentes[$id], $d); }
        else $docentes[$id] = $d;
    }
    $rel['importados'] = count($docentes);
    return [$docentes, $rel];
}

// Junta a lista importada à atual. Com $substituir, quem era de um PPG
// presente no arquivo e não está nele sai da lista (atualização anual).
function doc_aplicar(array $atuais, array $novos, bool $substituir): array
{
    $removidos = 0;
    if ($substituir) {
        $alvos = array_flip(array_map(fn($d) => sim_sem_acento(trim($d['ppg'])), $novos));
        foreach ($atuais as $id => $d) {
            if (isset($alvos[sim_sem_acento(trim($d['ppg']))]) && !isset($novos[$id])) { unset($atuais[$id]); $removidos++; }
        }
    }
    $atualizados = count(array_intersect_key($novos, $atuais));
    $agora = date('c');
    foreach ($novos as $id => $d) $atuais[$id] = $d + ['importadoEm' => $agora];
    return [$atuais, ['atualizados' => $atualizados, 'novos' => count($novos) - $atualizados, 'removidos' => $removidos]];
}
