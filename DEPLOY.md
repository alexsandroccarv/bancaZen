# Publicação automática (CI/CD) via SSH

Este template já vem com **integração contínua via GitHub Actions**: a cada
`push` na branch principal, o robô monta a pasta `dist/` e a copia para o seu
servidor Linux/VPS por **SSH (rsync)**. Você configura isto **uma vez** por
projeto (que reutilize este template).

> Suas senhas/chaves ficam guardadas nos **Secrets** do GitHub. Elas não
> entram no código e não são visíveis para ninguém depois de salvas.

---

## Visão geral (o que vai acontecer)

```
você faz "push" no GitHub
        │
        ▼
GitHub Actions:  valida JS  ->  node build.mjs (monta dist/)  ->  rsync dist/ -> seu servidor
```

O deploy só acontece quando os 5 secrets abaixo estiverem configurados. Antes
disso, o robô apenas valida e monta o site (fica "verde"), sem publicar.

Arquivos envolvidos:
- `.github/workflows/deploy.yml` — o workflow (quando/como roda).
- `.github/scripts/deploy.sh` — o script que faz o rsync/SSH.
- `build.mjs` — monta `dist/` a partir de `src/`.

---

## Passo 1 — Ter um lugar no servidor para o site

No seu servidor (via SSH), crie a pasta onde o site vai morar e dê permissão
ao seu usuário. Exemplo (ajuste o caminho ao seu servidor web — Apache/Nginx):

```bash
sudo mkdir -p /var/www/meuapp
sudo chown -R $USER:$USER /var/www/meuapp
```

⚠️ **Importante:** essa pasta será **espelhada** pelo deploy (o rsync usa
`--delete`). Use uma pasta **dedicada só ao site** — tudo que estiver nela e
não estiver no `dist/` será removido. Não aponte para a raiz do seu usuário
nem para uma pasta com outros arquivos.

Depois, configure o seu servidor web (Nginx/Apache) para servir essa pasta no
domínio desejado (isso é a configuração normal do seu servidor, feita uma
vez).

---

## Passo 2 — Criar uma chave SSH dedicada ao deploy

No **seu computador** (ou em qualquer terminal Linux/Mac; no Windows use o
Git Bash), gere um par de chaves **só para o deploy** (não use sua chave
pessoal). Troque `meuapp` pelo nome do seu projeto:

```bash
ssh-keygen -t ed25519 -C "deploy-meuapp" -f ~/.ssh/meuapp_deploy -N ""
```

Isso cria dois arquivos:
- `~/.ssh/meuapp_deploy`      → chave **PRIVADA** (vai para o GitHub, secret `SSH_KEY`)
- `~/.ssh/meuapp_deploy.pub`  → chave **PÚBLICA** (vai para o servidor)

Autorize a chave **pública** no servidor (troque `usuario` e `servidor`):

```bash
ssh-copy-id -i ~/.ssh/meuapp_deploy.pub usuario@servidor
```

> Sem `ssh-copy-id`? Copie manualmente o conteúdo de `meuapp_deploy.pub`
> para o arquivo `~/.ssh/authorized_keys` do usuário no servidor.

Teste que a chave funciona (deve entrar sem pedir senha):

```bash
ssh -i ~/.ssh/meuapp_deploy usuario@servidor
```

---

## Passo 3 — Cadastrar os Secrets no GitHub

No GitHub, abra o repositório e vá em:
**Settings → Secrets and variables → Actions → New repository secret**

Crie estes **5 secrets** (nome exatamente como abaixo):

| Nome          | Valor                                                                |
|---------------|-----------------------------------------------------------------------|
| `SSH_HOST`    | IP ou domínio do servidor (ex.: `200.100.50.10` ou `meuservidor.com`) |
| `SSH_USER`    | usuário SSH (ex.: `deploy` ou o seu usuário)                          |
| `SSH_PORT`    | porta SSH (geralmente `22`)                                           |
| `DEPLOY_PATH` | pasta do site no servidor (ex.: `/var/www/meuapp`)                    |
| `SSH_KEY`     | **conteúdo** do arquivo `~/.ssh/meuapp_deploy` (a chave PRIVADA)      |

Para o `SSH_KEY`, cole o arquivo **inteiro**, incluindo as linhas
`-----BEGIN OPENSSH PRIVATE KEY-----` e `-----END OPENSSH PRIVATE KEY-----`.
No terminal, veja o conteúdo com:

```bash
cat ~/.ssh/meuapp_deploy
```

---

## Passo 4 — Publicar

Antes de tudo, confirme em `.github/workflows/deploy.yml` que o gatilho
`branches: ['main']` bate com a branch principal do seu projeto (ajuste se
usar outro nome, ex. `master` ou `producao`).

Duas formas de disparar:

1. **Automático:** faça qualquer `push` na branch principal — o deploy roda.
2. **Manual:** no GitHub, aba **Actions → "Publicar" → Run workflow**.

Acompanhe em **Actions**. Se tudo estiver certo, ao final o passo "Publicar no
servidor" mostra `Deploy (rsync) concluído.` e o site aparece no seu domínio.

---

## URL do site (SEO/social e sitemap)

Para as metatags de compartilhamento (Open Graph/Twitter), o `canonical` e o
`sitemap.xml` ficarem com URLs **absolutas**, defina a variável `SITE_URL`
com o domínio do site (sem barra final), em:
**Settings → Secrets and variables → Actions → Variables → New variable**

| Nome       | Valor (exemplo)              |
|------------|------------------------------|
| `SITE_URL` | `https://meuapp.com.br`      |

O `build.mjs` substitui o placeholder `%SITE_URL%` por esse valor e gera o
`sitemap.xml`. Sem a variável, o build usa um placeholder e emite um aviso
(o site publica normalmente, mas os links sociais ficam incorretos).

Localmente: `SITE_URL=https://meuapp.com.br node build.mjs`.

---

## Resolução de problemas

- **"Secrets do ambiente não configurados"** → falta cadastrar os 5 secrets
  (Passo 3). O CI fica verde, mas não publica até você cadastrá-los.
- **Permissão negada (publickey)** → a chave pública não está no
  `authorized_keys` do servidor, ou o `SSH_USER`/`SSH_HOST`/`SSH_PORT` estão
  errados. Refaça o teste do Passo 2.
- **Conexão expira (timeout)** → o servidor bloqueia a porta SSH para a
  internet ou o IP/porta estão errados. Confirme com sua hospedagem.
- **O site publica, mas com arquivos a mais/velhos** → confirme que o
  `DEPLOY_PATH` aponta **só** para a pasta do site (o `--delete` espelha).
