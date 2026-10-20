<?php
/* ==========================================================================
   BuscaBanca — define a senha da área de administração (só linha de comando)
   --------------------------------------------------------------------------
   No servidor, na pasta do site:
       php api/cli/definir-senha.php
   (Se a pasta de dados não for a padrão, defina BUSCABANCA_DADOS antes.)
   Grava apenas o hash (password_hash) em <dados>/admin.json.
   ========================================================================== */
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
require_once __DIR__ . '/../lib/base.php';

$dir = bb_preparar_dados();
// Lê uma linha sem eco no terminal (a senha não aparece na tela).
function ler_oculto(string $rotulo): string
{
    fwrite(STDOUT, $rotulo);
    $tty = stream_isatty(STDIN);
    if ($tty) @system('stty -echo');
    $s = trim((string) fgets(STDIN));
    if ($tty) { @system('stty echo'); fwrite(STDOUT, "\n"); }
    return $s;
}
fwrite(STDOUT, "Pasta de dados: $dir\n");
$senha = ler_oculto('Nova senha (mínimo 10 caracteres): ');
$repete = ler_oculto('Repita a senha: ');

if (strlen($senha) < 10) { fwrite(STDERR, "Senha curta demais.\n"); exit(1); }
if ($senha !== $repete) { fwrite(STDERR, "As senhas não conferem.\n"); exit(1); }

file_put_contents("$dir/admin.json", json_encode(['hash' => password_hash($senha, PASSWORD_DEFAULT), 'definidaEm' => date('c')]));
@chmod("$dir/admin.json", 0640);
fwrite(STDOUT, "Senha definida.\n");
