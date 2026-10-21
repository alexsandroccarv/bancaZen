#!/usr/bin/env bash
# Validação completa do projeto: a mesma na CI (workflow validar.yml) e na
# máquina de quem desenvolve. Monta o dist/ e confere a estrutura publicada.
#   Uso: bash .github/scripts/validar.sh
# Requisitos: Node.js 20+ e PHP 8.0+ (CLI).
set -euo pipefail
cd "$(dirname "$0")/../.."

etapa() { echo; echo "== $*"; }
erro() { echo "::error::$*"; exit 1; }

etapa "Versões"
node --version
php --version | head -1
php -r 'exit(PHP_VERSION_ID >= 80000 ? 0 : 1);' || erro "PHP 8.0 ou superior é necessário."

etapa "Sintaxe dos módulos JS"
for f in src/js/*.js; do node --check "$f"; done

etapa "Sintaxe do backend PHP"
find src/api -name '*.php' -print0 | xargs -0 -n1 php -l >/dev/null

etapa "Testes do backend (extrator Lattes, proximidade, vínculos, base)"
php tools/testar.php

etapa "Contraste dos temas (WCAG AA)"
node tools/contrast-check.mjs

etapa "Montagem do dist/"
node build.mjs

etapa "Estrutura do dist/"
for f in index.html admin.html 404.html sitemap.xml js/layout.js js/app.js js/admin.js css/styles.css \
         api/buscar.php api/status.php api/admin.php api/.htaccess api/lib/base.php api/cli/definir-senha.php; do
  test -f "dist/$f" || erro "dist/$f ausente."
done
# Todas as páginas de apoio devem ser publicadas.
for p in termodeuso politicadeprivacidade ajuda sobre doeumcafe historico; do
  test -f "dist/$p.html" || erro "dist/$p.html ausente."
done
# Currículos e dados do backend nunca vão para a pasta publicada.
if find dist -iname '*.xml' ! -path dist/sitemap.xml | grep -q .; then erro "arquivo XML em dist/."; fi
if find dist \( -name 'corpus.json' -o -name 'admin.json' -o -name 'docentes.json' -o -name '*.zip' -o -iname '*.csv' \) | grep -q .; then erro "dados do backend em dist/."; fi

echo
echo "OK: validação concluída."
