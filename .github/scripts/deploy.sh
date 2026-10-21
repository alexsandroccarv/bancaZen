#!/usr/bin/env bash
# Deploy da pasta dist/ para o servidor via rsync sobre SSH.
# Variáveis vêm dos Secrets do GitHub (repositório ou ambiente "producao"):
#   SSH_HOST          (obrigatório)  ex.: servidor.exemplo.com
#   SSH_USER          (obrigatório)  ex.: deploy
#   SSH_KEY           (obrigatório)  chave PRIVADA SSH dedicada ao deploy
#   DEPLOY_PATH       (obrigatório)  pasta do site, caminho absoluto, ex.: /var/www/bancazen
#   SSH_PORT          (opcional, padrão 22)
#   SSH_KNOWN_HOSTS   (opcional) linha(s) do known_hosts do servidor; sem ela,
#                     a chave do servidor é aceita no primeiro contato (ssh-keyscan)
# E da variável (Actions → Variables):
#   BANCAZEN_DADOS  (opcional) pasta de dados do backend; padrão:
#                     <pasta acima do DEPLOY_PATH>/bancazen-dados
#
# Proteções:
#   - recusa DEPLOY_PATH raso (ex.: "/", "/var") e pasta de dados dentro do
#     DEPLOY_PATH (o rsync --delete apagaria os currículos) ou dentro de uma
#     pasta servida pela web (public_html, htdocs, www/html), como acontece
#     com o padrão em hospedagem compartilhada (cPanel);
#   - no primeiro deploy, recusa uma pasta não vazia que não seja do site
#     (marcador .bancazen-deploy), para não apagar outro conteúdo;
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
DADOS="${BANCAZEN_DADOS:-$(dirname "$DEPLOY_PATH")/bancazen-dados}"
DADOS="${DADOS%/}"

# ---- Verificações locais dos caminhos ----
case "$DEPLOY_PATH" in /*) ;; *) erro "DEPLOY_PATH deve ser um caminho absoluto (recebido: $DEPLOY_PATH).";; esac
case "$DADOS" in /*) ;; *) erro "BANCAZEN_DADOS deve ser um caminho absoluto (recebido: $DADOS).";; esac
NIVEIS=$(echo "$DEPLOY_PATH" | tr -cd '/' | wc -c)
[ "$NIVEIS" -ge 2 ] || erro "DEPLOY_PATH raso demais ($DEPLOY_PATH): use uma pasta dedicada, ex.: /var/www/bancazen."
case "$DADOS/" in "$DEPLOY_PATH"/*) erro "A pasta de dados ($DADOS) está dentro do DEPLOY_PATH: o deploy apagaria os currículos.";; esac
case "$DEPLOY_PATH/" in "$DADOS"/*) erro "O DEPLOY_PATH está dentro da pasta de dados ($DADOS).";; esac
# Os currículos não podem ficar numa pasta servida pela web.
case "$DADOS/" in */public_html/*|*/htdocs/*|*/www/html/*)
  erro "A pasta de dados ($DADOS) fica dentro de uma pasta pública da web: os currículos poderiam ser baixados. Defina a variável BANCAZEN_DADOS (Settings → Secrets and variables → Actions → Variables) com um caminho fora dela, ex.: /home/<usuário>/bancazen-dados (veja DEPLOY.md, hospedagem compartilhada).";;
esac

# O PHP usa o caminho gravado pelo build em api/lib/config-dados.php (ou o
# padrão, sem o arquivo). Ele precisa ser o mesmo verificado aqui: se a
# variável BANCAZEN_DADOS existir só no ambiente "producao", o build (que
# não usa o ambiente) não a vê e o PHP cairia no padrão.
CONFIG_DADOS=""
if [ -f dist/api/lib/config-dados.php ]; then
  CONFIG_DADOS=$(sed -n 's/^return "\(.*\)";$/\1/p' dist/api/lib/config-dados.php)
  CONFIG_DADOS="${CONFIG_DADOS%/}"
fi
ESPERADO=""
[ -n "${BANCAZEN_DADOS:-}" ] && ESPERADO="$DADOS"
if [ "$CONFIG_DADOS" != "$ESPERADO" ]; then
  erro "A pasta de dados do PHP (${CONFIG_DADOS:-padrão, ao lado do site}) difere da verificada pelo deploy ($DADOS). Crie BANCAZEN_DADOS como variável DO REPOSITÓRIO (Settings → Secrets and variables → Actions → Variables → Repository variables), não só no ambiente \"producao\"."
fi

# ---- Chave e known_hosts ----
mkdir -p ~/.ssh
chmod 700 ~/.ssh
# Normaliza o que costuma estragar a chave ao copiar e colar: quebras de
# linha do Windows (\r), espaços nas bordas das linhas e linhas em branco.
printf '%s\n' "$SSH_KEY" | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e '/^$/d' > ~/.ssh/id_deploy
# Chave colada numa linha só (quebras viraram espaços): remonta as linhas.
if [ "$(wc -l < ~/.ssh/id_deploy)" -eq 1 ] && grep -q -- '-----BEGIN .*-----END ' ~/.ssh/id_deploy; then
  sed -E 's/^(-----BEGIN [A-Z ]+-----) (.*) (-----END [A-Z ]+-----)$/\1\n\2\n\3/' ~/.ssh/id_deploy \
    | sed -E '2s/ +/\n/g' > ~/.ssh/id_deploy.tmp && mv ~/.ssh/id_deploy.tmp ~/.ssh/id_deploy
fi
chmod 600 ~/.ssh/id_deploy

# A chave precisa ser privada, no formato OpenSSH/PEM e SEM senha (o deploy
# não tem como digitá-la). Em caso de erro, diz qual é o problema sem nunca
# mostrar o conteúdo da chave.
if ! CHAVE_MSG=$(ssh-keygen -y -P '' -f ~/.ssh/id_deploy 2>&1 >/dev/null); then
  PRIMEIRA=$(head -1 ~/.ssh/id_deploy)
  if grep -q 'ENCRYPTED' ~/.ssh/id_deploy || echo "$CHAVE_MSG" | grep -qi 'passphrase'; then
    erro "SSH_KEY está protegida por senha (passphrase). Gere uma chave sem senha (ssh-keygen ... -N \"\") ou remova a senha: ssh-keygen -p -f <arquivo> -N \"\"."
  fi
  case "$PRIMEIRA" in
    PuTTY-User-Key-File-*)
      erro "SSH_KEY está no formato do PuTTY (.ppk). Converta para OpenSSH: puttygen chave.ppk -O private-openssh -o chave (ou, no PuTTYgen, Conversions → Export OpenSSH key) e cole o resultado no secret." ;;
    ssh-rsa\ *|ssh-ed25519\ *|ssh-dss\ *|ecdsa-sha2-*|sk-*)
      erro "SSH_KEY contém a chave PÚBLICA (formato do .pub). O secret precisa da chave PRIVADA (o arquivo sem .pub)." ;;
    ---\ BEGIN\ SSH2\ *)
      erro "SSH_KEY está no formato SSH2/RFC4716. Converta para OpenSSH: ssh-keygen -i -f chave > chave_openssh (e cole o resultado)." ;;
  esac
  if ! grep -q -- '-----BEGIN .*PRIVATE KEY-----' ~/.ssh/id_deploy; then
    erro "SSH_KEY não tem a linha -----BEGIN ... PRIVATE KEY-----: o conteúdo colado está incompleto ou não é uma chave privada."
  fi
  if ! grep -q -- '-----END .*PRIVATE KEY-----' ~/.ssh/id_deploy; then
    erro "SSH_KEY não tem a linha -----END ... PRIVATE KEY-----: o conteúdo foi colado pela metade."
  fi
  erro "SSH_KEY não foi aceita pelo ssh-keygen ($(echo "$CHAVE_MSG" | sed 's|\"[^\"]*\"|<arquivo>|' | head -1); $(wc -l < ~/.ssh/id_deploy) linhas). Copie de novo o arquivo da chave PRIVADA inteiro (cat ~/.ssh/bancazen_deploy) e cole no secret sem alterar nada."
fi
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
echo "Chave:    $(ssh-keygen -l -f ~/.ssh/id_deploy | awk '{print $1, $2, $NF}') (confira com a chave autorizada no servidor)"

# ---- Conexão (antes de qualquer outra coisa, para um erro claro) ----
if ! remoto true; then
  echo "::error::Não foi possível entrar no servidor por SSH com a chave do SSH_KEY."
  echo "Causas mais comuns:"
  echo "  1. A chave PÚBLICA não está autorizada para o SSH_USER no servidor (~/.ssh/authorized_keys)."
  echo "     No cPanel: SSH Access → Manage SSH Keys → na chave importada, Manage → Authorize."
  echo "  2. SSH_USER errado (no cPanel, é o usuário da conta cPanel)."
  echo "  3. O acesso SSH (shell) não está habilitado para a conta na hospedagem."
  echo "  4. SSH_KEY e a chave pública autorizada não formam um par (compare a impressão digital acima com: ssh-keygen -l -f chave.pub)."
  exit 1
fi

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
  case "$DADOS_REAL/" in */public_html/*|*/htdocs/*|*/www/html/*) echo "::error::A pasta de dados ($DADOS_REAL) fica dentro de uma pasta pública da web."; exit 1;; esac
fi

# Primeiro deploy: só em pasta vazia (ou só com .well-known/.user.ini).
if [ ! -f "$SITE/.bancazen-deploy" ]; then
  OUTROS=$(find "$SITE" -mindepth 1 -maxdepth 1 ! -name .well-known ! -name .user.ini | head -5)
  if [ -n "$OUTROS" ]; then
    echo "::error::$SITE não está vazia e não tem o marcador .bancazen-deploy. Para não apagar outro conteúdo, o deploy parou."
    echo "Conteúdo encontrado (até 5 itens):"; echo "$OUTROS"
    echo "Se a pasta é mesmo do bancaZen, crie o marcador: touch '$SITE/.bancazen-deploy'"
    exit 1
  fi
fi

# PHP: a versão da linha de comando costuma ser a mesma do servidor web.
if command -v php >/dev/null 2>&1; then
  echo "PHP no servidor: $(php -r 'echo PHP_VERSION;')"
  php -r 'exit(PHP_VERSION_ID >= 80000 ? 0 : 1);' || aviso "O PHP de linha de comando é anterior ao 8.0; o bancaZen precisa de PHP 8.0+ no servidor web."
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
  N=$( (find "$DADOS/xml" -maxdepth 1 -name '*.xml' 2>/dev/null || true) | wc -l)
  echo "Currículos guardados: $N"
  [ -f "$DADOS/admin.json" ] || aviso "Senha da administração não definida. No servidor: cd '$SITE' && php api/cli/definir-senha.php"
fi
REMOTO

# ---- Cópia ----
# Marcador: identifica a pasta como do bancaZen nos próximos deploys.
echo "Publicado pelo deploy do bancaZen." > dist/.bancazen-deploy

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
