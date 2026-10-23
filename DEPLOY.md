# Integração contínua e publicação (rsync/SSH)

O bancaZen é publicado por **GitHub Actions**: cada mudança é validada e,
quando entra na `main`, o site (`dist/`) é copiado para o servidor por
**rsync sobre SSH**. A configuração é feita **uma vez**.

> Chaves e senhas ficam nos **Secrets** do GitHub: não entram no código e
> não podem ser lidas depois de salvas.

---

## Visão geral

```
push em qualquer branch / pull request
    └─ "Validar": sintaxe JS e PHP, testes do backend, contraste, build, conferência do dist/

push na main
    └─ "Version bump (PATCH)": incrementa o VERSION e faz o commit
         └─ "Publicar" (ao terminar o bump): valida de novo, monta o dist/ com a versão nova
              ├─ verificações no servidor (PHP, pasta de dados, senha da administração)
              ├─ rsync dist/ -> DEPLOY_PATH  (ou tar por SSH, se o servidor não tiver rsync)
              └─ verificação do site publicado (SITE_URL)
```

O deploy espera o incremento de versão para publicar a `main` já com o
`VERSION` novo; assim o rodapé do site mostra a versão certa. Também dá para
publicar à mão: **Actions → Publicar → Run workflow** (só na `main`).

Enquanto os secrets não forem cadastrados, o "Publicar" valida, pula a cópia
e fica verde.

Arquivos envolvidos:

| Arquivo | Papel |
|---|---|
| `.github/workflows/validar.yml` | validação (push, pull request e antes do deploy) |
| `.github/workflows/version-bump.yml` | incremento automático do PATCH na `main` |
| `.github/workflows/deploy.yml` | publicação, depois do incremento |
| `.github/scripts/validar.sh` | a validação em si (roda também na sua máquina) |
| `.github/scripts/deploy.sh` | verificações no servidor e cópia por rsync/SSH |
| `.github/scripts/verificar-site.sh` | testa o site publicado |
| `build.mjs` | monta `dist/` a partir de `src/` |

Para validar localmente antes do push (Node.js 20+ e PHP 8.0+):

```bash
bash .github/scripts/validar.sh
```

---

## Passo 1: pastas no servidor

O servidor precisa de **PHP 8.0 ou superior** (Apache com `mod_php`/PHP-FPM
ou Nginx com PHP-FPM). Não há banco de dados nem dependências.

São duas pastas, **uma ao lado da outra**:

| Pasta | Conteúdo | Quem escreve |
|---|---|---|
| `/var/www/bancazen` (`DEPLOY_PATH`) | o site, espelhado a cada deploy | o usuário de deploy (SSH) |
| `/var/www/bancazen-dados` | currículos (XML), índice, hash da senha | o PHP (ex.: `www-data`) |

```bash
# usuário de deploy (sem senha; entra só com a chave do Passo 2)
sudo adduser --disabled-password --gecos "" deploy

# pasta do site: do usuário de deploy, legível pelo servidor web
sudo mkdir -p /var/www/bancazen
sudo chown deploy:deploy /var/www/bancazen

# pasta de dados: do usuário do PHP, fora da pasta do site
sudo mkdir -p /var/www/bancazen-dados
sudo chown www-data:www-data /var/www/bancazen-dados
sudo chmod 750 /var/www/bancazen-dados
```

Configure o servidor web para servir `/var/www/bancazen` no domínio (uma
vez). Use **HTTPS**: a senha da administração trafega no login.

**Por que a pasta de dados fica fora do site:** para não ser servida pela web
e para não ser apagada pelo deploy (o rsync usa `--delete` e espelha só o
`DEPLOY_PATH`). O deploy **se recusa** a publicar se a pasta de dados estiver
dentro do `DEPLOY_PATH`.

**Outro local para os dados:** defina a variável `BANCAZEN_DADOS` (Passo 3);
o build grava o caminho em `api/lib/config-dados.php`, sem mexer no servidor
web. Alternativa: `SetEnv BANCAZEN_DADOS /caminho` (Apache) ou
`fastcgi_param BANCAZEN_DADOS /caminho;` (Nginx/PHP-FPM).

**O que o deploy preserva no `DEPLOY_PATH`:** `.well-known/` (validação do
certificado Let's Encrypt) e `.user.ini` (limites do PHP em hospedagem
compartilhada). Todo o resto é espelhado do `dist/`.

**Primeiro deploy:** a pasta do site precisa estar **vazia** (podendo ter só
`.well-known/` e `.user.ini`). Se houver outro conteúdo, o deploy para sem
apagar nada e mostra o que encontrou. Depois do primeiro deploy, o marcador
`.bancazen-deploy` identifica a pasta.

---

### Hospedagem compartilhada (cPanel)

Em hospedagem compartilhada não há `sudo` nem `/var/www`: o site fica dentro
do `public_html` da conta (ex.: `/home1/<usuário>/public_html/labs/bancazen`)
e tudo roda com o mesmo usuário (o da conta cPanel), que também é o do PHP.

- **Pasta de dados fora do `public_html` (obrigatório).** O padrão "pasta ao
  lado do site" cairia dentro do `public_html`, que é servido pela web; o
  deploy **se recusa** a publicar assim. Defina a variável `BANCAZEN_DADOS`
  (Passo 3) com um caminho na raiz da conta, ex.:
  `/home1/<usuário>/bancazen-dados`. O deploy cria a pasta.
- **Caminho real da conta:** veja em *cPanel → Informações gerais* (Home
  Directory) ou, por SSH, com `echo $HOME`.
- **Acesso SSH:** precisa estar habilitado para a conta (algumas hospedagens
  pedem para ativar no suporte). A porta costuma ser diferente de 22 (ex.:
  2222); informe-a em `SSH_PORT`.
- **Chave SSH:** se importar a chave pública pelo cPanel (*SSH Access → Manage
  SSH Keys → Import Key*), é preciso **autorizá-la** depois: na lista de
  chaves públicas, *Manage → Authorize*. Sem isso, o deploy recebe
  `Permission denied`. Não use chave gerada com senha (passphrase).
- **PHP:** escolha PHP 8.0 ou superior em *cPanel → Select PHP Version* (ou
  *MultiPHP Manager*) para o domínio.

## Passo 2: chave SSH dedicada ao deploy

No **seu computador**, gere um par de chaves **só para o deploy**:

```bash
ssh-keygen -t ed25519 -C "deploy-bancazen" -f ~/.ssh/bancazen_deploy -N ""
```

- `~/.ssh/bancazen_deploy` → chave **PRIVADA** (secret `SSH_KEY`)
- `~/.ssh/bancazen_deploy.pub` → chave **PÚBLICA** (vai para o servidor)

Autorize a chave pública para o usuário de deploy e teste:

```bash
ssh-copy-id -i ~/.ssh/bancazen_deploy.pub deploy@servidor
ssh -i ~/.ssh/bancazen_deploy deploy@servidor 'echo ok; php -v | head -1; which rsync'
```

Recomendado: guarde a chave **do servidor** para o GitHub conferir que está
falando com a máquina certa (secret `SSH_KNOWN_HOSTS`):

```bash
ssh-keyscan -p 22 servidor     # confira a impressão digital com a da hospedagem
```

---

## Passo 3: secrets e variáveis no GitHub

**Secrets** (Settings → Secrets and variables → Actions → *Secrets*). Podem
ficar no repositório ou no ambiente **`producao`** (Settings → Environments),
que o deploy usa; no ambiente dá para exigir aprovação manual antes de
publicar.

| Nome | Obrigatório | Valor |
|---|---|---|
| `SSH_HOST` | sim | IP ou domínio do servidor |
| `SSH_USER` | sim | usuário de deploy (ex.: `deploy`) |
| `SSH_KEY` | sim | conteúdo **inteiro** de `~/.ssh/bancazen_deploy` (com as linhas `BEGIN`/`END`) |
| `DEPLOY_PATH` | sim | pasta do site, caminho absoluto (ex.: `/var/www/bancazen`) |
| `SSH_PORT` | não | porta SSH (padrão `22`) |
| `SSH_KNOWN_HOSTS` | não (recomendado) | saída do `ssh-keyscan` do Passo 2. Sem ele, a chave do servidor é aceita no primeiro contato |

**Variáveis** (Settings → Secrets and variables → Actions → *Variables* →
**Repository variables**). Crie-as no **repositório**, não no ambiente: o
site é montado numa etapa que não usa o ambiente `producao`, e o deploy para
se o caminho dos dados que o PHP vai usar for diferente do que ele verificou.


| Nome | Obrigatório | Valor |
|---|---|---|
| `SITE_URL` | recomendado | endereço do site, sem barra final (ex.: `https://bancazen.exemplo.br`). Usado nas metatags, no `sitemap.xml` e na verificação depois do deploy |
| `BANCAZEN_DADOS` | em hospedagem compartilhada, sim | caminho absoluto da pasta de dados, se não for a irmã `bancazen-dados` (ex.: `/home1/<usuário>/bancazen-dados`) |

---

## Passo 4: publicar

1. **Automático:** um push (ou merge) na `main` dispara o incremento de
   versão e, em seguida, o "Publicar".
2. **Manual:** **Actions → Publicar → Run workflow** (branch `main`).

No log do passo **Publicar (rsync/SSH)** aparecem, antes da cópia: a versão do
PHP do servidor, a situação da pasta de dados, quantos currículos estão
guardados e um aviso se a senha da administração ainda não foi definida.

Depois da cópia, o passo **Verificar o site publicado** (com `SITE_URL`)
confere que:

- a página inicial e a `admin.html` respondem;
- `api/status.php` devolve JSON, ou seja, o PHP está sendo executado;
- `api/lib` e `api/cli` não expõem código-fonte.

Se alguma verificação falhar, o workflow fica vermelho.

### Verificação do site

A verificação acessa o site como um visitante, a partir dos executores do
GitHub (que ficam em data centers do Azure). Muitas hospedagens compartilhadas
bloqueiam IPs de data center ou programas automáticos, e respondem 404 ou
403 mesmo com o site funcionando no navegador. Por isso, se o acesso a partir
do GitHub falhar, a mesma verificação é refeita **de dentro do servidor**,
pela conexão SSH do deploy (com o `curl` do servidor):

| Resultado | Significado |
|---|---|
| `OK: site publicado verificado` | o site respondeu ao GitHub |
| aviso "responde normalmente a partir do servidor" + `OK (a partir do servidor)` | o site está no ar; a hospedagem bloqueia o GitHub (não é preciso fazer nada) |
| erro "também falhou quando verificado de dentro do servidor" | problema real: confira o `SITE_URL` (o endereço que abre o bancaZen no navegador, sem `#` e sem barra final) e a configuração do site |

---

## Passo 5: senha da administração (uma vez, e para trocar)

Depois do primeiro deploy, no servidor, com o usuário do PHP:

```bash
cd /var/www/bancazen
sudo -u www-data php api/cli/definir-senha.php
```

Só o hash (`password_hash`) é gravado em `bancazen-dados/admin.json`.

---

## Backend: bloqueios e limites

**Bloquear `api/lib` e `api/cli`.** No Apache o `api/.htaccess` já faz isso
(requer `AllowOverride` habilitado). No Nginx, acrescente ao `server { }`:

```nginx
location ~ ^/api/(lib|cli)/ { deny all; return 404; }
location ~ \.php$ { include snippets/fastcgi-php.conf; fastcgi_pass unix:/run/php/php-fpm.sock; }
```

**Limites de envio.** A administração envia os arquivos em lotes de até 15
arquivos e 6 MB, compatíveis com o padrão do PHP (`max_file_uploads = 20`,
`post_max_size = 8M`). Um currículo maior que `upload_max_filesize` (padrão
2 MB) exige aumentar esse limite no `php.ini` ou no `.user.ini` da pasta do
site (que o deploy preserva).

**Backup.** Copie a pasta `bancazen-dados` (XML + `corpus.json` +
`admin.json`).

---

## Resolução de problemas

| Mensagem no log | Causa e solução |
|---|---|
| `Secrets de deploy não configurados` | Faltam os secrets obrigatórios (Passo 3). O workflow fica verde, mas não publica. |
| `Permission denied (publickey)` / `Não foi possível entrar no servidor por SSH` | A chave pública não está autorizada para o `SSH_USER` (no cPanel: *Manage → Authorize*), o `SSH_USER` está errado, o SSH não está habilitado na conta, ou o `SSH_KEY` não é o par da chave autorizada (o log mostra a impressão digital da chave usada). Refaça o teste do Passo 2. |
| `SSH_KEY está protegida por senha` | Gere uma chave sem senha (`-N ""`) ou remova a senha: `ssh-keygen -p -f ~/.ssh/bancazen_deploy -N ""`, e atualize o secret. |
| `SSH_KEY está no formato do PuTTY (.ppk)` | Converta para OpenSSH (`puttygen chave.ppk -O private-openssh -o chave`, ou PuTTYgen → *Conversions → Export OpenSSH key*) e cole o resultado. |
| `SSH_KEY contém a chave PÚBLICA` / `não tem a linha BEGIN/END` / `não foi aceita pelo ssh-keygen` | Cole o arquivo da chave **privada** inteiro (`cat ~/.ssh/bancazen_deploy`), com as linhas `BEGIN` e `END`. Quebras de linha do Windows e espaços são corrigidos automaticamente. |
| `A pasta de dados ... fica dentro de uma pasta pública da web` | Defina `BANCAZEN_DADOS` fora do `public_html`/`htdocs` (seção "Hospedagem compartilhada"). |
| `A pasta de dados do PHP ... difere da verificada pelo deploy` | `BANCAZEN_DADOS` foi criada só no ambiente `producao`. Crie-a como variável **do repositório** (Passo 3). |
| `Host key verification failed` | A chave do servidor mudou ou o `SSH_KNOWN_HOSTS` está errado. Confira com a hospedagem e refaça o `ssh-keyscan`. |
| `Connection timed out` | O servidor bloqueia a porta SSH para a internet, ou o IP/porta estão errados. |
| `DEPLOY_PATH raso demais` / `deve ser um caminho absoluto` | Use uma pasta dedicada com caminho completo, ex.: `/var/www/bancazen`. |
| `A pasta de dados ... está dentro do DEPLOY_PATH` | Mova a pasta de dados para fora do site (ou ajuste `BANCAZEN_DADOS`). |
| `não está vazia e não tem o marcador .bancazen-deploy` | Primeiro deploy numa pasta com outro conteúdo. Esvazie a pasta ou, se ela já é do bancaZen, crie o marcador com `touch`. |
| `Pasta de dados criada ... Dê a posse ao usuário do PHP` | O deploy criou a pasta com o usuário de deploy; o PHP precisa escrever nela: `sudo chown -R www-data:www-data /var/www/bancazen-dados`. |
| `Senha da administração não definida` | Faça o Passo 5. |
| `O site responde normalmente a partir do servidor, mas não aos executores do GitHub` (aviso) | A hospedagem bloqueia os IPs do GitHub; o site está no ar e a publicação é considerada OK (seção "Verificação do site"). Para a verificação direta funcionar, peça ao suporte para liberar o acesso de IPs de data center. |
| `O site também falhou quando verificado de dentro do servidor` | O `SITE_URL` não é o endereço público do site, ou o site não está respondendo. |
| `api/status.php devolveu código PHP` | O servidor web não executa PHP nessa pasta. Instale/habilite o PHP (8.0+) no site. |
| `api/lib/... expõe código-fonte` ou `respondeu com conteúdo` | Bloqueie `api/lib` e `api/cli` (seção "Backend"). No Apache, confira o `AllowOverride`. |
| `rsync indisponível/falhou: usando o envio por tar` | O servidor não tem rsync; o deploy usou tar por SSH, com o mesmo resultado. Instalar o rsync deixa o envio incremental. |
