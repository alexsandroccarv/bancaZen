<?php
/* ==========================================================================
   BuscaBanca — Extrator do XML do Currículo Lattes
   --------------------------------------------------------------------------
   Lê o XML exportado pela Plataforma Lattes (CNPq) e extrai apenas o que
   interessa para medir a proximidade temática e verificar vínculos: resumo
   do currículo, linhas de pesquisa, projetos, áreas do conhecimento,
   palavras-chave, títulos da formação, das produções e das orientações,
   autores de cada produção, quem orientou a pessoa e quem ela orientou.

   Nomes de tags e atributos seguem o schema oficial CurriculoLattes (o mesmo
   usado pelo importador do lattesZen). Como o currículo é quase todo em
   ATRIBUTOS, um varredor de tags por expressão regular basta, sem DOM: não
   há resolução de entidades externas (XXE) nem dependência de extensões.

   Dados de contato (e-mail, telefone, endereço) NÃO são extraídos.
   ========================================================================== */

/* ------------------------------ codificação ------------------------------ */
// O Lattes exporta em ISO-8859-1; respeita o encoding declarado no cabeçalho.
function lattes_decodificar(string $bytes): string
{
    $enc = preg_match('/encoding=["\']([^"\']+)["\']/i', substr($bytes, 0, 200), $m) ? strtoupper($m[1]) : 'UTF-8';
    if ($enc === 'UTF-8' || $enc === 'UTF8') {
        return preg_match('//u', $bytes) ? $bytes : lattes_latin1($bytes);
    }
    if (function_exists('mb_convert_encoding')) {
        $s = @mb_convert_encoding($bytes, 'UTF-8', $enc === 'ISO-8859-1' ? 'Windows-1252' : $enc);
        if (is_string($s)) return $s;
    }
    if (function_exists('iconv')) {
        $s = @iconv($enc, 'UTF-8//IGNORE', $bytes);
        if (is_string($s)) return $s;
    }
    return lattes_latin1($bytes);
}
// ISO-8859-1 -> UTF-8 sem extensões (cada byte é o próprio code point).
function lattes_latin1(string $bytes): string
{
    $out = '';
    $n = strlen($bytes);
    for ($i = 0; $i < $n; $i++) {
        $c = ord($bytes[$i]);
        $out .= $c < 0x80 ? $bytes[$i] : chr(0xC0 | ($c >> 6)) . chr(0x80 | ($c & 0x3F));
    }
    return $out;
}

/* ---------------------------------- ZIP ---------------------------------- */
// A Plataforma Lattes entrega o XML dentro de um .zip (curriculo.xml).
// Leitor mínimo com gzinflate (zlib), sem depender da extensão zip.
function lattes_eh_zip(string $bytes): bool
{
    return strncmp($bytes, "PK\x03\x04", 4) === 0;
}
function lattes_xmls_do_zip(string $b): array
{
    $n = strlen($b);
    $eocd = -1;
    for ($i = $n - 22; $i >= max(0, $n - 65557); $i--) {
        if (substr($b, $i, 4) === "PK\x05\x06") { $eocd = $i; break; }
    }
    if ($eocd < 0) throw new RuntimeException('arquivo ZIP inválido');
    $total = unpack('v', $b, $eocd + 10)[1];
    $pos = unpack('V', $b, $eocd + 16)[1];
    $saida = [];
    for ($k = 0; $k < $total; $k++) {
        if (substr($b, $pos, 4) !== "PK\x01\x02") break;
        $metodo = unpack('v', $b, $pos + 10)[1];
        $tamComp = unpack('V', $b, $pos + 20)[1];
        $lenNome = unpack('v', $b, $pos + 28)[1];
        $lenExtra = unpack('v', $b, $pos + 30)[1];
        $lenCom = unpack('v', $b, $pos + 32)[1];
        $local = unpack('V', $b, $pos + 42)[1];
        $nome = substr($b, $pos + 46, $lenNome);
        $pos += 46 + $lenNome + $lenExtra + $lenCom;
        if (!preg_match('/\.xml$/i', $nome)) continue;
        $ini = $local + 30 + unpack('v', $b, $local + 26)[1] + unpack('v', $b, $local + 28)[1];
        $dados = substr($b, $ini, $tamComp);
        if ($metodo === 0) $saida[] = ['nome' => $nome, 'bytes' => $dados];
        elseif ($metodo === 8) {
            $x = @gzinflate($dados);
            if ($x === false) throw new RuntimeException("não foi possível descompactar $nome");
            $saida[] = ['nome' => $nome, 'bytes' => $x];
        }
    }
    return $saida;
}
// Lê um arquivo (.xml ou .zip) e devolve [['xml' => bytes, 'pessoa' => registro], ...].
function lattes_ler_arquivo(string $nome, string $bytes): array
{
    $itens = lattes_eh_zip($bytes) ? lattes_xmls_do_zip($bytes) : [['nome' => $nome, 'bytes' => $bytes]];
    if (!$itens) throw new RuntimeException('nenhum XML encontrado no ZIP');
    $out = [];
    foreach ($itens as $it) {
        $origem = count($itens) > 1 ? "$nome/{$it['nome']}" : $nome;
        $out[] = ['xml' => $it['bytes'], 'pessoa' => lattes_parse(lattes_decodificar($it['bytes']), $origem)];
    }
    return $out;
}

/* -------------------------------- helpers -------------------------------- */
function lattes_unescape(string $s): string
{
    return preg_replace_callback('/&(#x[0-9a-f]+|#\d+|[a-z]+);/i', function ($m) {
        $e = $m[1];
        if ($e[0] === '#') {
            $cp = ($e[1] === 'x' || $e[1] === 'X') ? hexdec(substr($e, 2)) : (int) substr($e, 1);
            return $cp > 0 && $cp <= 0x10FFFF ? lattes_chr($cp) : $m[0];
        }
        $ent = ['amp' => '&', 'lt' => '<', 'gt' => '>', 'quot' => '"', 'apos' => "'"];
        return $ent[strtolower($e)] ?? $m[0];
    }, $s);
}
function lattes_chr(int $cp): string
{
    if ($cp < 0x80) return chr($cp);
    if ($cp < 0x800) return chr(0xC0 | ($cp >> 6)) . chr(0x80 | ($cp & 0x3F));
    if ($cp < 0x10000) return chr(0xE0 | ($cp >> 12)) . chr(0x80 | (($cp >> 6) & 0x3F)) . chr(0x80 | ($cp & 0x3F));
    return chr(0xF0 | ($cp >> 18)) . chr(0x80 | (($cp >> 12) & 0x3F)) . chr(0x80 | (($cp >> 6) & 0x3F)) . chr(0x80 | ($cp & 0x3F));
}
// Remove marcação HTML presente no resumo "rico" do currículo.
function lattes_sem_html(string $s): string
{
    return trim(preg_replace('/\s+/u', ' ', preg_replace('/<[^>]*>/', ' ', $s)));
}
function lattes_atributos(string $src): array
{
    $o = [];
    if ($src === '') return $o;
    preg_match_all('/([A-Z0-9-]++)\s*+=\s*+(?:"([^"]*+)"|\'([^\']*+)\')/', $src, $mm, PREG_SET_ORDER);
    foreach ($mm as $m) $o[$m[1]] = lattes_unescape(isset($m[3]) && $m[3] !== '' ? $m[3] : $m[2]);
    return $o;
}
function lattes_pick(array $o, array $chaves): string
{
    foreach ($chaves as $k) if (!empty($o[$k])) return $o[$k];
    return '';
}
// Remove campos vazios (o índice fica menor).
function lattes_compacto(array $o): array
{
    return array_filter($o, fn($v) => $v !== null && $v !== '');
}

const LATTES_TITULOS = ['TITULO-DO-ARTIGO', 'TITULO-DO-LIVRO', 'TITULO-DO-CAPITULO-DO-LIVRO',
    'TITULO-DO-TRABALHO-TECNICO', 'TITULO-DO-TRABALHO', 'TITULO-DO-TEXTO', 'TITULO-DO-SOFTWARE',
    'TITULO-DO-PRODUTO', 'TITULO-DO-PROCESSO', 'TITULO-DA-APRESENTACAO', 'DENOMINACAO', 'TITULO'];
const LATTES_ANOS = ['ANO-DO-ARTIGO', 'ANO-DO-TRABALHO', 'ANO-DO-TEXTO', 'ANO', 'ANO-DESENVOLVIMENTO',
    'ANO-DE-OBTENCAO-DO-TITULO', 'ANO-DE-CONCLUSAO'];
// Titulações da formação acadêmica: tag => [nível, rótulo] (maior nível = maior titulação).
const LATTES_TITULACOES = [
    'LIVRE-DOCENCIA' => [7, 'Livre-docência'], 'POS-DOUTORADO' => [6, 'Pós-doutorado'],
    'DOUTORADO' => [5, 'Doutorado'], 'MESTRADO-PROFISSIONALIZANTE' => [4, 'Mestrado profissional'],
    'MESTRADO' => [3, 'Mestrado'], 'ESPECIALIZACAO' => [2, 'Especialização'], 'GRADUACAO' => [1, 'Graduação'],
];

// Seções cujos títulos descrevem a atuação da pessoa (e não de terceiros).
function lattes_secao(array $pilha): ?string
{
    for ($i = count($pilha) - 1; $i >= 0; $i--) {
        $t = $pilha[$i];
        if ($t === 'PRODUCAO-BIBLIOGRAFICA' || $t === 'PRODUCAO-TECNICA' || $t === 'OUTRA-PRODUCAO') {
            // Orientações ficam dentro de OUTRA-PRODUCAO, mas têm peso próprio.
            return in_array('ORIENTACOES-CONCLUIDAS', $pilha, true) ? 'orientacoes' : 'producoes';
        }
        if ($t === 'DADOS-COMPLEMENTARES') {
            return in_array('ORIENTACOES-EM-ANDAMENTO', $pilha, true) ? 'orientacoes' : null;
        }
    }
    return null;
}

/* --------------------------------- parse --------------------------------- */
// Recebe o texto (UTF-8) do XML e devolve o registro compacto da pessoa.
function lattes_parse(string $xml, string $origem = ''): array
{
    $p = [
        'id' => '', 'nome' => '', 'citacoes' => [], 'origem' => $origem, 'atualizacao' => '',
        'instituicao' => '', 'unidade' => '', 'cidade' => '', 'uf' => '',
        'titulacao' => '', 'nivel' => 0, 'bancasMestrado' => 0, 'bancasDoutorado' => 0,
        'resumo' => '', 'linhas' => [], 'projetos' => [], 'areas' => [], 'palavrasChave' => [],
        'formacao' => [], 'producoes' => [], 'orientacoes' => [], 'orientadores' => [],
    ];
    $pilha = [];
    $areas = [];
    $pcs = [];
    $raiz = false;
    // Produção/orientação aberta: recebe os AUTORES e o DETALHAMENTO que vêm
    // logo depois do DADOS-BASICOS no mesmo elemento.
    $ultimo = null; // [seção, índice]

    // Quantificadores possessivos (*+): atributos longos (resumo) não estouram
    // o limite de retrocesso do PCRE.
    $ok = preg_match_all('/<([A-Z][A-Z0-9-]*+)((?:\s++[A-Z0-9-]++\s*+=\s*+(?:"[^"]*+"|\'[^\']*+\'))*+)\s*+(\/?)>|<\/([A-Z][A-Z0-9-]*+)\s*+>/',
        $xml, $tags, PREG_SET_ORDER);
    if ($ok === false) throw new RuntimeException('XML não pôde ser lido');
    foreach ($tags as $m) {
        if (!empty($m[4])) { // fechamento
            $i = array_search($m[4], array_reverse($pilha, true), true);
            if ($i !== false) $pilha = array_slice($pilha, 0, $i);
            continue;
        }
        $tag = $m[1];
        $a = lattes_atributos($m[2] ?? '');
        $topo = $pilha ? $pilha[count($pilha) - 1] : '';

        if ($tag === 'CURRICULO-VITAE') {
            $raiz = true;
            $p['id'] = $a['NUMERO-IDENTIFICADOR'] ?? '';
            $d = preg_replace('/\D/', '', $a['DATA-ATUALIZACAO'] ?? '');
            if (strlen($d) === 8) $p['atualizacao'] = substr($d, 4, 4) . '-' . substr($d, 2, 2) . '-' . substr($d, 0, 2);
        } elseif ($tag === 'DADOS-GERAIS') {
            $p['nome'] = $a['NOME-COMPLETO'] ?? '';
            $p['citacoes'] = array_values(array_filter(array_map('trim', explode(';', $a['NOME-EM-CITACOES-BIBLIOGRAFICAS'] ?? ''))));
        } elseif ($tag === 'RESUMO-CV') {
            $p['resumo'] = lattes_sem_html($a['TEXTO-RESUMO-CV-RICO'] ?? '');
        } elseif ($tag === 'ENDERECO-PROFISSIONAL') {
            $p['instituicao'] = $a['NOME-INSTITUICAO-EMPRESA'] ?? '';
            $p['unidade'] = ($a['NOME-UNIDADE'] ?? '') ?: ($a['NOME-ORGAO'] ?? '');
            $p['cidade'] = $a['CIDADE'] ?? '';
            $p['uf'] = $a['UF'] ?? '';
        } elseif (isset(LATTES_TITULACOES[$tag]) && $topo === 'FORMACAO-ACADEMICA-TITULACAO') {
            [$nivelNum, $nivel] = LATTES_TITULACOES[$tag];
            $concluido = empty($a['STATUS-DO-CURSO']) || $a['STATUS-DO-CURSO'] === 'CONCLUIDO';
            if ($concluido && $nivelNum > $p['nivel']) { $p['nivel'] = $nivelNum; $p['titulacao'] = $nivel; }
            $titulo = lattes_pick($a, ['TITULO-DA-DISSERTACAO-TESE', 'TITULO-DO-TRABALHO-DE-CONCLUSAO-DE-CURSO', 'TITULO-DO-TRABALHO']);
            if ($titulo !== '') $p['formacao'][] = ['t' => $titulo, 'a' => $a['ANO-DE-CONCLUSAO'] ?? ''];
            $orientador = lattes_pick($a, ['NOME-COMPLETO-DO-ORIENTADOR', 'NOME-DO-ORIENTADOR']);
            if ($orientador !== '' || !empty($a['NUMERO-ID-ORIENTADOR'])) {
                $p['orientadores'][] = lattes_compacto(['n' => $orientador, 'id' => $a['NUMERO-ID-ORIENTADOR'] ?? '', 'a' => $a['ANO-DE-CONCLUSAO'] ?? '', 'nivel' => $nivel]);
            }
            if (!empty($a['NOME-DO-CO-ORIENTADOR'])) {
                $p['orientadores'][] = lattes_compacto(['n' => $a['NOME-DO-CO-ORIENTADOR'], 'a' => $a['ANO-DE-CONCLUSAO'] ?? '', 'nivel' => $nivel, 'co' => 1]);
            }
        } elseif ($tag === 'LINHA-DE-PESQUISA') {
            $t = implode('. ', array_filter([$a['TITULO-DA-LINHA-DE-PESQUISA'] ?? '', $a['OBJETIVOS-LINHA-DE-PESQUISA'] ?? '']));
            if ($t !== '') $p['linhas'][] = $t;
        } elseif ($tag === 'PROJETO-DE-PESQUISA') {
            $t = implode('. ', array_filter([$a['NOME-DO-PROJETO'] ?? '', $a['DESCRICAO-DO-PROJETO'] ?? '']));
            // Projeto sem ano de fim está em andamento: conta como atual.
            $ano = ($a['ANO-FIM'] ?? '') ?: (!empty($a['ANO-INICIO']) ? date('Y') : '');
            if ($t !== '') $p['projetos'][] = ['t' => $t, 'a' => $ano];
        } elseif (preg_match('/^AREA-DO-CONHECIMENTO-\d+$/', $tag)) {
            foreach (['NOME-DA-AREA-DO-CONHECIMENTO', 'NOME-DA-SUB-AREA-DO-CONHECIMENTO', 'NOME-DA-ESPECIALIDADE'] as $k) {
                if (!empty($a[$k])) $areas[$a[$k]] = true;
            }
        } elseif ($tag === 'PALAVRAS-CHAVE') {
            for ($i = 1; $i <= 6; $i++) {
                $v = trim($a["PALAVRA-CHAVE-$i"] ?? '');
                if ($v !== '') $pcs[$v] = true;
            }
        } elseif ($tag === 'PARTICIPACAO-EM-BANCA-DE-MESTRADO') {
            $p['bancasMestrado']++;
        } elseif ($tag === 'PARTICIPACAO-EM-BANCA-DE-DOUTORADO') {
            $p['bancasDoutorado']++;
        } elseif (strncmp($tag, 'DADOS-BASICOS', 13) === 0) {
            $secao = lattes_secao($pilha);
            $titulo = lattes_pick($a, LATTES_TITULOS);
            $ultimo = null;
            if ($secao && $titulo !== '') {
                $p[$secao][] = ['t' => $titulo, 'a' => lattes_pick($a, LATTES_ANOS)];
                $ultimo = [$secao, count($p[$secao]) - 1];
            }
        } elseif ($tag === 'AUTORES' && $ultimo) {
            $p[$ultimo[0]][$ultimo[1]]['au'][] = lattes_compacto([
                'n' => $a['NOME-COMPLETO-DO-AUTOR'] ?? '', 'c' => $a['NOME-PARA-CITACAO'] ?? '', 'id' => $a['NRO-ID-CNPQ'] ?? '',
            ]);
        } elseif (strncmp($tag, 'DETALHAMENTO', 12) === 0 && $ultimo) {
            $orientado = lattes_pick($a, ['NOME-DO-ORIENTADO', 'NOME-DO-ORIENTANDO']);
            if ($orientado !== '') {
                $p[$ultimo[0]][$ultimo[1]]['o'] = $orientado;
                if (!empty($a['NUMERO-ID-ORIENTADO'])) $p[$ultimo[0]][$ultimo[1]]['oid'] = $a['NUMERO-ID-ORIENTADO'];
            }
        }

        if (($m[3] ?? '') !== '/') $pilha[] = $tag;
    }

    if (!$raiz) throw new RuntimeException('não é um XML de currículo Lattes (falta CURRICULO-VITAE)');
    $p['areas'] = array_map('strval', array_keys($areas));
    $p['palavrasChave'] = array_map('strval', array_keys($pcs));
    if ($p['id'] === '') $p['id'] = $p['nome'] ?: $origem;
    return $p;
}
