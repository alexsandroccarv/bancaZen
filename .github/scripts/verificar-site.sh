#!/usr/bin/env bash
# Verifica o site publicado (depois do deploy). Requer SITE_URL (variável do
# Actions); sem ela, só avisa. Confere que:
#   - a página inicial e a administração respondem;
#   - o PHP está sendo executado (api/status.php devolve JSON, não código);
#   - as bibliotecas do backend não vazam código-fonte (api/lib, api/cli).
#   Uso: SITE_URL=https://exemplo.br bash .github/scripts/verificar-site.sh
set -euo pipefail

if [ -z "${SITE_URL:-}" ]; then
  echo "::warning::SITE_URL não definida: verificação do site publicado pulada."
  exit 0
fi
BASE="${SITE_URL%/}"
FALHAS=0
falha() { echo "::error::$*"; FALHAS=$((FALHAS + 1)); }
baixar() { curl -sS -L --max-time 30 -o /tmp/resposta -w '%{http_code}' "$BASE/$1" || echo 000; }

# Logo após o rsync o servidor pode levar alguns segundos (cache/opcache).
for tentativa in 1 2 3; do
  [ "$(baixar '')" = 200 ] && break
  sleep 5
done

[ "$(baixar '')" = 200 ] || falha "Página inicial não respondeu 200 em $BASE/."
[ "$(baixar admin.html)" = 200 ] || falha "admin.html não respondeu 200."

COD=$(baixar api/status.php)
if grep -q '<?php' /tmp/resposta; then
  falha "api/status.php devolveu código PHP: o servidor web não está executando PHP."
elif [ "$COD" != 200 ] || ! grep -q '"curriculos"' /tmp/resposta; then
  falha "api/status.php não devolveu o JSON esperado (HTTP $COD): $(head -c 200 /tmp/resposta)"
else
  echo "api/status.php: $(cat /tmp/resposta)"
fi

for arq in api/lib/base.php api/lib/lattes.php api/cli/definir-senha.php; do
  COD=$(baixar "$arq")
  if grep -q '<?php' /tmp/resposta; then
    falha "$arq expõe código-fonte (HTTP $COD)."
  elif [ "$COD" = 200 ] && [ -s /tmp/resposta ]; then
    falha "$arq respondeu com conteúdo (HTTP $COD); bloqueie api/lib e api/cli (veja DEPLOY.md)."
  else
    echo "$arq: bloqueado ou sem conteúdo (HTTP $COD)."
  fi
done

[ "$FALHAS" -eq 0 ] || { echo "$FALHAS verificação(ões) do site falharam."; exit 1; }
echo "OK: site publicado verificado em $BASE."
