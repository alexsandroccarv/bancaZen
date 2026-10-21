#!/usr/bin/env bash
# Deploy da pasta dist/ para o servidor via rsync sobre SSH.
# Variáveis vêm dos Secrets do GitHub (repositório ou ambiente "producao"):
#   SSH_HOST          (obrigatório)  ex.: servidor.exemplo.com
#   SSH_USER          (obrigatório)  ex.: deploy
#   SSH_KEY           (obrigatório)  chave PRIVADA SSH dedicada ao deploy
#   DEPLOY_PATH       (obrigatório)  pasta do site, caminho absoluto, ex.: /var/www/buscabanca
#   SSH_PORT          (opcional, padrão 22)
#   SSH_KNOWN_HOSTS   (opcional) linha(s) do known_hosts do servidor; sem ela,
#                     a chave do servidor é aceita no primeiro contato (ssh-keyscan)
# E da variável (Actions → Variables):
#   BUSCABANCA_DADOS  (opcional) pasta de dados do backend; padrão:
#                     <pasta acima do DEPLOY_PATH>/buscabanca-dados
#
# Proteções:
#   - recusa DEPLOY_PATH raso (ex.: "/", "/var") e pasta de dados dentro do
#     DEPLOY_PATH (o rsync --delete apagaria os currículos);
#   - no primeiro deploy, recusa uma pasta não vazia que não seja do site
#     (marcador .buscabanca-deploy), para não apagar outro conteúdo;
#   - preserva .well-known/ (certificados Let's Encrypt) e .user.ini
#     (limites do PHP) do servidor, que não vêm no dist/.
set -euo pipefail

saida() { [ -n "${GITHUB_OUTPUT:-}" ] && echo "$1" >> "$GITHUB_OUTPUT" || true; }
erro() { echo "::error::$*"; exit 1; }

if [ -z "${SSH_HOST:-}" ] || [ -z "${SSH_USER:-}" ] || [ -z "${SSH_KEY:-}" ] || [ -z "${DEPLOY_PATH:-}" ]; then
  echo "::warning::Secrets de deploy não configurados (SSH_HOST/SSH_USER/SSH_KEY/DEPLOY_PATH)."
  echo "Pulei o deploy. Configure os secrets do repositório ou do ambiente \"producao\" (veja DEPLOY.md)."
  saida "publicado=nao"
  exit 0
fi

test -f dist/index.html || erro "dist/ não encontrado (rode node build.mjs antes)."

PORT="${SSH_PORT:-22}"
DEPLOY_PATH="${DEPLOY_PATH%/}"
DADOS="${BUSCABANCA_DADOS:-$(dirname "$DEPLOY_PATH")/buscabanca-dados}"
DADOS="${DADOS%/}"

# ---- Verificações locais dos caminhos ----
case "$DEPLOY_PATH" in /*) ;; *) erro "DEPLOY_PATH deve ser um caminho absoluto (recebido: $DEPLOY_PATH).";; esac
case "$DADOS" in /*) ;; *) erro "BUSCABANCA_DADOS deve ser um caminho absoluto (recebido: $DADOS).";; esac
NIVEIS=$(echo "$DEPLOY_PATH" | tr -cd '/' | wc -c)
[ "$NIVEIS" -ge 2 ] || erro "DEPLOY_PATH raso demais ($DEPLOY_PATH): use uma pasta dedicada, ex.: /var/www/buscabanca."
case "$DADOS/" in "$DEPLOY_PATH"/*) erro "A pasta de dados ($DADOS) está dentro do DEPLOY_PATH: o deploy apagaria os currículos.";; esac
case "$DEPLOY_PATH/" in "$DADOS"/*) erro "O DEPLOY_PATH está dentro da pasta de dados ($DADOS).";; esac

# ---- Chave e known_hosts ----
mkdir -p ~/.ssh
chmod 700 ~/.ssh
printf '%s\n' "$SSH_KEY" > ~/.ssh/id_deploy
chmod 600 ~/.ssh/id_deploy
if [ -n "${SSH_KNOWN_HOSTS:-}" ]; then
  printf '%s\n' "$SSH_KNOWN_HOSTS" >> ~/.ssh/known_hosts
  CHECAGEM=yes
else
  echo "::notice::SSH_KNOWN_HOSTS não definido: a chave do servidor será aceita no primeiro contato."
  ssh-keyscan -p "$PORT" -H "$SSH_HOST" >> ~/.ssh/known_hosts 2>/dev/null || true
  CHECAGEM=accept-new
fi
chmod 600 ~/.ssh/known_hosts

SSH_OPTS="-i $HOME/.ssh/id_deploy -p ${PORT} -o UserKnownHostsFile=$HOME/.ssh/known_hosts -o StrictHostKeyChecking=${CHECAGEM} -o ConnectTimeout=30 -o BatchMode=yes"
REMOTE="${SSH_USER}@${SSH_HOST}"
remoto() { ssh $SSH_OPTS "$REMOTE" "$@"; }

echo "Servidor: ${REMOTE} (porta ${PORT})"
echo "Site:     ${DEPLOY_PATH}"
echo "Dados:    ${DADOS}"

# ---- Verificações no servidor (antes de copiar qualquer coisa) ----
# O script remoto recebe os caminhos como argumentos ($1 site, $2 dados).
remoto bash -s -- "$DEPLOY_PATH" "$DADOS" <<'REMOTO'
set -euo pipefail
SITE="$1"; DADOS="$2"
aviso() { echo "::warning::$*"; }

mkdir -p "$SITE" || { echo "::error::Não foi possível criar $SITE no servidor."; exit 1; }

# Caminhos reais (resolve links simbólicos) para conferir a separação.
SITE_REAL=$(cd "$SITE" && pwd -P)
if [ -d "$DADOS" ]; then
  DADOS_REAL=$(cd "$DADOS" && pwd -P)
  case "$DADOS_REAL/" in "$SITE_REAL"/*) echo "::error::A pasta de dados ($DADOS_REAL) fica dentro do site ($SITE_REAL)."; exit 1;; esac
fi

# Primeiro deploy: só em pasta vazia (ou só com .well-known/.user.ini).
if [ ! -f "$SITE/.buscabanca-deploy" ]; then
  OUTROS=$(find "$SITE" -mindepth 1 -maxdepth 1 ! -name .well-known ! -name .user.ini | head -5)
  if [ -n "$OUTROS" ]; then
    echo "::error::$SITE não está vazia e não tem o marcador .buscabanca-deploy. Para não apagar outro conteúdo, o deploy parou."
    echo "Conteúdo encontrado (até 5 itens):"; echo "$OUTROS"
    echo "Se a pasta é mesmo do BuscaBanca, crie o marcador: touch '$SITE/.buscabanca-deploy'"
    exit 1
  fi
fi

# PHP: a versão da linha de comando costuma ser a mesma do servidor web.
if command -v php >/dev/null 2>&1; then
  echo "PHP no servidor: $(php -r 'echo PHP_VERSION;')"
  php -r 'exit(PHP_VERSION_ID >= 80000 ? 0 : 1);' || aviso "O PHP de linha de comando é anterior ao 8.0; o BuscaBanca precisa de PHP 8.0+ no servidor web."
else
  aviso "php não encontrado na linha de comando do servidor: confira se o servidor web executa PHP 8.0+ e use o caminho completo do php para definir a senha."
fi

# Pasta de dados: cria se faltar; o PHP (usuário do servidor web) precisa escrever nela.
if [ ! -d "$DADOS" ]; then
  if mkdir -p "$DADOS/xml" 2>/dev/null; then
    chmod 770 "$DADOS" "$DADOS/xml" 2>/dev/null || true
    aviso "Pasta de dados criada em $DADOS. Dê a posse ao usuário do PHP (ex.: sudo chown -R www-data:www-data '$DADOS')."
  else
    aviso "Não foi possível criar a pasta de dados $DADOS. Crie-a no servidor (veja DEPLOY.md)."
  fi
fi
if [ -d "$DADOS" ]; then
  echo "Pasta de dados: $(ls -ld "$DADOS" | awk '{print $1, $3":"$4}')"
  N=$(find "$DADOS/xml" -maxdepth 1 -name '*.xml' 2>/dev/null | wc -l || echo 0)
  echo "Currículos guardados: $N"
  [ -f "$DADOS/admin.json" ] || aviso "Senha da administração não definida. No servidor: cd '$SITE' && php api/cli/definir-senha.php"
fi
REMOTO

# ---- Cópia ----
# Marcador: identifica a pasta como do BuscaBanca nos próximos deploys.
echo "Publicado pelo deploy do BuscaBanca." > dist/.buscabanca-deploy

# rsync: incremental, apaga o que saiu do dist/ (--delete), aplica tudo no
# fim (--delay-updates) e não tenta copiar dono/grupo (-rlptz em vez de -a).
RSYNC_FILTROS=(--filter='P .well-known/' --filter='P .user.ini')
if command -v rsync >/dev/null 2>&1 && remoto 'command -v rsync >/dev/null 2>&1' && \
   rsync -rlptz --delete --delay-updates --chmod=D755,F644 "${RSYNC_FILTROS[@]}" \
         -e "ssh ${SSH_OPTS}" ./dist/ "${REMOTE}:${DEPLOY_PATH}/"; then
  echo "Deploy (rsync) concluído."
else
  # Hospedagem sem rsync no servidor: tar por SSH, emulando o --delete
  # (preservando .well-known/ e .user.ini).
  echo "::warning::rsync indisponível/falhou: usando o envio por tar sobre SSH."
  tar -C dist -czf - . | remoto "set -e; cd '${DEPLOY_PATH}' && \
    find . -mindepth 1 -maxdepth 1 ! -name .well-known ! -name .user.ini -exec rm -rf {} + && \
    tar -xzf - && find . -path ./.well-known -prune -o -type d -exec chmod 755 {} + -o -type f -exec chmod 644 {} +"
  echo "Deploy (tar) concluído."
fi

remoto "test -f '${DEPLOY_PATH}/index.html' && test -f '${DEPLOY_PATH}/api/buscar.php'" \
  || erro "Após o deploy, index.html ou api/buscar.php não estão em ${DEPLOY_PATH}."
saida "publicado=sim"
