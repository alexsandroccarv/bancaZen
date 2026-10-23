#!/usr/bin/env bash
# Verifica o site publicado (depois do deploy). Requer SITE_URL (variável do
# Actions); sem ela, só avisa. Confere que:
#   - a página inicial e a administração respondem;
#   - o PHP está sendo executado (api/status.php devolve JSON, não código);
#   - as bibliotecas do backend não vazam código-fonte (api/lib, api/cli).
#
# Dois caminhos, na ordem:
#   1. direto do executor do GitHub (como um visitante);
#   2. se o 1 falhar e houver acesso SSH (SSH_HOST/SSH_USER e a chave gravada
#      pelo deploy.sh em ~/.ssh/id_deploy), a mesma verificação feita DE
#      DENTRO do servidor, com curl. Hospedagens compartilhadas costumam
#      bloquear IPs de data center (os executores do GitHub ficam no Azure)
#      ou programas automáticos: se o servidor consegue e o GitHub não, o
#      site está no ar e o bloqueio é externo (aviso, não falha).
#   Uso: SITE_URL=https://exemplo.br bash .github/scripts/verificar-site.sh
set -euo pipefail

if [ -z "${SITE_URL:-}" ]; then
  echo "::warning::SITE_URL não definida: verificação do site publicado pulada."
  exit 0
fi
BASE="${SITE_URL%/}"
RESP=$(mktemp)
# Identificação de navegador: firewalls (Imunify360, ModSecurity) costumam
# barrar o User-Agent padrão do curl.
UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 bancaZen-verificacao'

# Caminho 1: do executor. Grava o corpo em $RESP e imprime o código HTTP.
baixar_github() {
  # Em falha de conexão o curl já escreve "000" no -w.
  local c
  c=$(curl -sS -L --max-time 30 -A "$UA" -o "$RESP" -w '%{http_code}' "$BASE/$1" 2>/dev/null) || true
  echo "${c:-000}"
}

# Caminho 2: de dentro do servidor, pela conexão SSH do deploy.
# Uma só conexão para todas as requisições: hospedagens compartilhadas
# limitam conexões SSH seguidas (o deploy acabou de abrir várias).
# (Caminho curto: o socket tem limite de 108 bytes.)
CONTROLE_DIR=$(mktemp -d /tmp/vsite.XXXXXX)
CONTROLE="$CONTROLE_DIR/%C"
SSH_OPTS="-i $HOME/.ssh/id_deploy -p ${SSH_PORT:-22} -o UserKnownHostsFile=$HOME/.ssh/known_hosts -o StrictHostKeyChecking=yes -o BatchMode=yes -o ConnectTimeout=30 -o ControlMaster=auto -o ControlPath=$CONTROLE -o ControlPersist=120"
tem_ssh() { [ -n "${SSH_HOST:-}" ] && [ -n "${SSH_USER:-}" ] && [ -f "$HOME/.ssh/id_deploy" ]; }
NOTA=$(mktemp)
encerrar() {
  rm -f "$RESP" "$NOTA"
  if tem_ssh; then ssh $SSH_OPTS -O exit "${SSH_USER}@${SSH_HOST}" >/dev/null 2>&1 || true; fi
  rm -rf "$CONTROLE_DIR"
}
trap encerrar EXIT
baixar_servidor() {
  # O servidor imprime o código na 1ª linha, um diagnóstico na 2ª e, em
  # seguida, até 4 KB do corpo. Códigos especiais: sem-curl e ssh (a conexão
  # SSH falhou). O diagnóstico vai para $NOTA (a função roda em subshell).
  local saida st=0
  # O ssh junta os argumentos num só comando de texto: printf %q protege os
  # espaços e parênteses do User-Agent.
  saida=$(ssh $SSH_OPTS "${SSH_USER}@${SSH_HOST}" "bash -s -- $(printf '%q ' "$BASE/$1" "$UA")" 2>"$NOTA.ssh" <<'REMOTO'
url=$1; ua=$2; t=$(mktemp)
if ! command -v curl >/dev/null 2>&1; then echo sem-curl; echo "curl ausente"; exit 0; fi
pedir() { curl -sS -L --max-time 20 -A "$ua" -o "$t" -w '%{http_code}' "$@" "$url" 2>"$t.err"; }
c=$(pedir) || true; c=${c:-000}; nota=""
if [ "$c" = 000 ]; then
  # Sem resposta: muitas hospedagens não deixam o servidor alcançar o próprio
  # endereço público. Repete com o mesmo nome (e certificado) em 127.0.0.1;
  # -k porque a conexão não sai da máquina.
  nota="endereço público: $(head -c 150 "$t.err" | tr '\n' ' ')"
  hp=${url#*://}; hp=${hp%%/*}; host=${hp%%:*}
  case $url in https:*) porta=443;; *) porta=80;; esac
  [ "$hp" != "$host" ] && porta=${hp#*:}
  c=$(pedir -k --resolve "$host:$porta:127.0.0.1") || true; c=${c:-000}
  if [ "$c" = 000 ]; then nota="$nota; 127.0.0.1: $(head -c 150 "$t.err" | tr '\n' ' ')"
  else nota="$nota; respondeu via 127.0.0.1"; fi
fi
echo "$c"; echo "$nota"; head -c 4000 "$t"; rm -f "$t" "$t.err"
REMOTO
) || st=$?
  if [ "$st" = 255 ]; then
    echo "conexão SSH falhou: $(tr '\n' ' ' < "$NOTA.ssh" | head -c 200)" > "$NOTA"
    : > "$RESP"; rm -f "$NOTA.ssh"; echo ssh; return
  fi
  rm -f "$NOTA.ssh"
  local cod=${saida%%$'\n'*} resto=""
  [[ "$saida" == *$'\n'* ]] && resto=${saida#*$'\n'}
  printf '%s\n' "${resto%%$'\n'*}" > "$NOTA"
  if [[ "$resto" == *$'\n'* ]]; then printf '%s' "${resto#*$'\n'}" > "$RESP"; else : > "$RESP"; fi
  [[ "$cod" =~ ^([0-9]{3}|sem-curl)$ ]] && echo "$cod" || echo 000
}

# Roda as verificações com o caminho $1 (função de download). Mensagens de
# problema vão para $PROBLEMAS; devolve o número de problemas.
verificar() {
  local baixar=$1 cod arq
  PROBLEMAS=()
  [ "$($baixar '')" = 200 ] || PROBLEMAS+=("Página inicial não respondeu 200 em $BASE/.")
  [ "$($baixar admin.html)" = 200 ] || PROBLEMAS+=("admin.html não respondeu 200.")
  cod=$($baixar api/status.php)
  if grep -q '<?php' "$RESP"; then
    PROBLEMAS+=("api/status.php devolveu código PHP: o servidor web não está executando PHP.")
  elif [ "$cod" != 200 ] || ! grep -q '"curriculos"' "$RESP"; then
    PROBLEMAS+=("api/status.php não devolveu o JSON esperado (HTTP $cod): $(head -c 120 "$RESP" | tr '\n' ' ')")
  else
    echo "  api/status.php: $(head -c 200 "$RESP")"
  fi
  for arq in api/lib/base.php api/lib/lattes.php api/cli/definir-senha.php; do
    cod=$($baixar "$arq")
    if grep -q '<?php' "$RESP"; then
      PROBLEMAS+=("$arq expõe código-fonte (HTTP $cod).")
    elif [ "$cod" = 200 ] && [ -s "$RESP" ]; then
      PROBLEMAS+=("$arq respondeu com conteúdo (HTTP $cod); bloqueie api/lib e api/cli (veja DEPLOY.md).")
    else
      echo "  $arq: bloqueado ou sem conteúdo (HTTP $cod)."
    fi
  done
  return ${#PROBLEMAS[@]}
}

# Logo após o rsync o servidor pode levar alguns segundos (cache/opcache).
for tentativa in 1 2 3; do
  [ "$(baixar_github '')" = 200 ] && break
  sleep 5
done

echo "Verificando $BASE a partir do GitHub…"
if verificar baixar_github; then
  echo "OK: site publicado verificado em $BASE."
  exit 0
fi
PROBLEMAS_GITHUB=("${PROBLEMAS[@]}")

if ! tem_ssh; then
  for p in "${PROBLEMAS_GITHUB[@]}"; do echo "::error::$p"; done
  echo "${#PROBLEMAS_GITHUB[@]} verificação(ões) do site falharam."
  exit 1
fi

for p in "${PROBLEMAS_GITHUB[@]}"; do echo "  (GitHub) $p"; done
echo "Verificando $BASE a partir do servidor (SSH)…"
COD_SERVIDOR=$(baixar_servidor '')
DIAG=$(cat "$NOTA")
echo "  servidor -> página inicial: HTTP $COD_SERVIDOR${DIAG:+ ($DIAG)}"
case "$COD_SERVIDOR" in
  sem-curl|ssh|000)
    # Nenhuma resposta HTTP de dentro do servidor: não dá para concluir nada
    # sobre o site. O rsync já foi confirmado pelo deploy.sh; avisa sem falhar.
    for p in "${PROBLEMAS_GITHUB[@]}"; do echo "::warning::(GitHub) $p"; done
    echo "::warning::Verificação inconclusiva: o GitHub recebeu erro e o servidor não obteve resposta HTTP do próprio site (${DIAG:-sem detalhes}). Os arquivos foram publicados; confira o site no navegador. Veja DEPLOY.md, \"Verificação do site\"."
    exit 0 ;;
esac
if verificar baixar_servidor; then
  echo "::warning::O site responde normalmente a partir do servidor, mas não aos executores do GitHub (provável bloqueio de IPs de data center ou firewall da hospedagem). Publicação considerada OK. Veja DEPLOY.md, \"Verificação do site\"."
  echo "OK: site publicado verificado em $BASE (a partir do servidor)."
  exit 0
fi
for p in "${PROBLEMAS[@]}"; do echo "::error::$p"; done
echo "::error::O site também falhou quando verificado de dentro do servidor: confira o SITE_URL (o endereço que abre o bancaZen no navegador, sem # e sem barra final) e a configuração do site."
echo "${#PROBLEMAS[@]} verificação(ões) do site falharam."
exit 1
