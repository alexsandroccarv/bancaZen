# Projeto: bancaZen (PROFIAP)

## Visão geral
Aplicação web (site estático + backend PHP) que indica membros externos
para banca de defesa de mestrado: a administração cadastra, num formulário
único só de arquivos, a planilha de docentes (CSV, com universidade, PPG e
situação; linha sem PPG = PROFIAP) e os currículos Lattes (XML/ZIP); a partir do título, resumo e palavras-chave do
trabalho, mostra duas listas de até 10 pessoas com maior proximidade temática
(0 a 1, ordem decrescente), sem vínculo com discente/orientação: **Rede
PROFIAP** (PPG = PROFIAP) e **Externa** (qualquer outro PPG). Base: templateZen.
- **O grupo da banca vem só do PPG** (`bb_grupo_do_ppg`: PROFIAP, sem
  diferenciar maiúsculas/acentos/espaços, → Rede PROFIAP; outro → Externa).
  Não há campo "grupo" nos formulários; um "grupo" gravado por versões
  anteriores é ignorado.

## Lattes e proximidade
- **Currículos e índice nunca são públicos**: nada de XML no repositório
  nem em `src/`/`dist/`; o navegador recebe só o resultado (`bb_publico`).
  Ficam na pasta de dados fora da raiz do site (`BANCAZEN_DADOS`, padrão
  `../bancazen-dados`), que o deploy (`rsync --delete`) não toca.
- Backend PHP 8 sem dependências em `src/api/`: extrator
  `lib/lattes.php` (tags do schema `CurriculoLattes`, o mesmo do lattesZen;
  não extrair dados de contato), proximidade `lib/similaridade.php`
  (TF-IDF + cosseno), vínculos `lib/vinculos.php`, base/sessão
  `lib/base.php`; endpoints `buscar.php` (público), `status.php` (público,
  só a contagem) e `admin.php` (sessão + token CSRF).
- Mesmo ID Lattes no upload: fica o de `DATA-ATUALIZACAO` mais recente.
- Lista de docentes dos programas (`lib/docentes.php`, `docentes.json` na
  pasta de dados): importada de CSV pela Administração, **nunca versionada**
  (a planilha tem e-mails; `.gitignore` bloqueia `*.csv`). Guarda
  só nome, universidade, PPG, situação (Permanente/Colaborador/
  Visitante), ID Lattes e e-mail (opcional, só na Administração; nunca em
  `bb_publico`/`buscar.php`); outras colunas são descartadas. Quem
  está na lista tem universidade, PPG e situação da lista
  (`bb_programa_efetivo`); senão, valem os dados gravados com o XML (PPG
  da inclusão pelo servidor ou da correção na tabela; sem instituição, a do
  Lattes). Sem PPG nenhum, o currículo fica guardado **sem dados e fora da
  busca** (`bb_tem_dados`; `buscar.php` e `status.php` filtram). A
  Administração mostra a conferência XML x planilha (sem dados; planilha
  sem XML). A planilha substitui a lista de cada PPG que traz
  (`doc_aplicar`). Exibição: Nome, Universidade, PPG,
  Situação no programa e Link do Lattes. Modelo do CSV: `doc_modelo_csv()`
  (download em `api/admin.php?acao=modelo-docentes`; gerado, não é arquivo,
  porque `*.csv` é bloqueado); linhas com ID `0000000000000000` são exemplos
  e são ignoradas.
- Conformidade ética: pessoa com vínculo (coautoria, orientação, mesma
  pessoa) nunca entra nas listas; aparece à parte com o motivo.
  "Confirmado" = ID Lattes ou nome completo; "provável" = sobrenome + ao
  menos duas iniciais.
- Ao mudar o backend, rodar `php tools/testar.php` (currículos fictícios em
  `tools/fixtures/`; discente e orientadora em `tools/fixtures/envolvidos/`).
  Currículos reais não entram em `tools/fixtures/`.
- Senha da administração: `php api/cli/definir-senha.php` no servidor.
- Zona de risco (Administração): ação `limpar` de `admin.php` (`bb_limpar`;
  confirmação `LIMPAR` conferida no servidor) apaga currículos (índice e
  `<dados>/xml/*`) e/ou a lista de docentes; nunca o `admin.json`.
- XMLs copiados direto para `<dados>/xml/` (rsync/FTP) só entram na busca
  depois de incluídos: Administração, "Currículos guardados no servidor"
  (ação `reindexar` de `admin.php`, em lotes com cursor pelo nome do
  arquivo), ou `php api/cli/reindexar.php` (`bb_reindexar`; `--simular`,
  `--ppg`, `--organizar`; programa: índice > lista de docentes > `--ppg`).

## Padrões de UI
- Página principal em seções (abas com ícone na barra superior, nome visível
  a partir de 640px): `#inicio` (apresentação e funcionamento),
  `#dissertacao` (nome e universidade da discente, que preenche o critério
  de instituição a desconsiderar sem sobrescrever o digitado; título, resumo,
  palavras-chave; nada disso é gravado no servidor), `#orientacao`, `#bancas` (conferência, critérios, busca e
  listas) e `#administracao` (`js/admin.js`, só consulta o servidor ao abrir).
  O endereço da seção fica na URL; botões `data-ir="<seção>"` trocam de
  seção (`layout.js`). `admin.html` só redireciona para `#administracao`.
- Cabeçalho/rodapé (site estático HTML+JS): fonte única em `src/js/chrome.js`
  (injeta em `#app-header`/`#app-footer`). Não recriar por página. O `index.html`
  tem seu próprio cabeçalho (com abas); as páginas de apoio usam o `chrome.js`.
- Versão React: `src/components/Header.jsx` e `Footer.jsx` (mesmas classes e
  chaves de `localStorage`) — para projetos com bundler.
- Recursos externos (Tailwind/Font Awesome) e cores da marca: `src/js/cdn.js`
  (um só lugar). Lógica de tema/contraste/fonte/abas/nome: `src/js/layout.js`.
- Favicon: sempre o logo do projeto, em SVG (`src/logo.svg`), referenciado
  via `<link rel="icon" type="image/svg+xml">`. Ao trocar a marca, substituir
  `src/logo.svg` (mantendo o nome).
- Temas: 9 paletas em `styles.css` (`html[data-tz-theme="…"]`, variáveis
  `--tz-*`) — Catppuccin Latte/Mocha, Drácula, GitHub Light/Dark, gov.br,
  Rosé Pine Dawn, Solarized Light/Dark; padrão **gov.br**. Novos/alterados
  temas devem passar no `tools/contrast-check.mjs` (WCAG AA).
- Acessibilidade: manter landmarks, foco visível, um `<h1>` por página,
  rótulos (`aria-label`) em botões só-ícone e `prefers-reduced-motion`.

## Onboarding (novo projeto)
- `node scripts/setup.mjs` — troca os placeholders (nome, repo, autor,
  licença, cor da marca) de uma vez. Também aceita flags.
- Definir a variável `SITE_URL` (GitHub Actions → Variables) para as
  metatags sociais e o `sitemap.xml` saírem com URL absoluta.

## Fluxo de trabalho (Git)
1. Toda solicitação vira uma **Issue documentada** no GitHub antes de qualquer código.
2. Resolver direto na `main`; o commit inclui `Closes #<numero>` (fecha a issue).
3. Atualizar o `CHANGELOG.md` (formato [Keep a Changelog 1.1.0](https://keepachangelog.com/pt-BR/1.1.0/),
   referenciando o número da issue) e o `historico.html` (uma entrada da versão
   com o(s) issue(s) fechado(s)).
4. Ao dar push na `main`, a Action `version-bump.yml` incrementa a CORREÇÃO
   automaticamente.

> Contribuições externas seguem o fluxo com branch/PR do `CONTRIBUTING.md`.

## Versionamento ([SemVer 2.0.0](https://semver.org/lang/pt-BR/): MAIOR.MENOR.CORREÇÃO)
- PATCH: incrementado automaticamente pela CI a cada merge na main — não mexer manualmente
- MINOR/MAJOR: só eu (humano) altero o arquivo `VERSION`, numa PR separada, quando decidir uma mudança maior (marco)
- Toda entrada do CHANGELOG.md referencia o número da issue
- A cada mudança de numeração, documentar em `src/historico.html` uma seção
  da versão com os issues fechados (links via `data-issue`, montados de
  `APP_CONFIG.repo`); marcos (MAIOR/MENOR) usam `data-marco="true"`.
- Antes da **1.0.0**: concluir o checklist de Go-Live (`docs/GO-LIVE-1.0.md`).
  No novo repositório, rodar uma vez o workflow "Semear issues de Go-Live
  (v1.0.0)" (Actions) para materializar as tarefas (de `.github/go-live-issues.json`)
  como issues `go-live`.

## CI e deploy (detalhes em `DEPLOY.md`)
- Validação em todo push/PR: `validar.yml` → `.github/scripts/validar.sh`
  (rodar localmente antes do push).
- Publicação: `deploy.yml` roda DEPOIS do `version-bump.yml` na `main`
  (`workflow_run`), valida de novo e publica o `dist/` por rsync/SSH
  (`.github/scripts/deploy.sh`), depois testa o site
  (`.github/scripts/verificar-site.sh`; se a hospedagem bloquear os IPs do
  GitHub, refaz a verificação de dentro do servidor por SSH, também via 127.0.0.1, e só avisa; sem resposta HTTP nenhuma, é inconclusiva e só avisa). Manual: Actions → Publicar (só `main`).
- Segredos (repositório ou ambiente `producao`): `SSH_KEY`, `SSH_HOST`,
  `SSH_USER`, `DEPLOY_PATH`; opcionais `SSH_PORT`, `SSH_KNOWN_HOSTS`.
- Variáveis: `SITE_URL` (metatags, `sitemap.xml`, verificação pós-deploy) e
  `BANCAZEN_DADOS` (opcional; caminho da pasta de dados).
- O `deploy.sh` nunca deve apagar a pasta de dados: recusa dados dentro do
  `DEPLOY_PATH`, pasta alheia no primeiro deploy (marcador
  `.bancazen-deploy`) e preserva `.well-known/` e `.user.ini`.

## Comandos úteis
- `node build.mjs` — monta a pasta `dist/` a partir de `src/` (injeta
  versão/data, substitui `%SITE_URL%` e gera `sitemap.xml`).
- `bash .github/scripts/validar.sh` — validação completa (a mesma da CI).
- `php tools/testar.php` — testa extrator, proximidade, vínculos e a regra
  do mesmo ID.
- `php -S localhost:8000 -t dist` — servidor local (após o build).
- `node scripts/setup.mjs` — setup do novo projeto (placeholders).
- `node tools/contrast-check.mjs` — audita o contraste (WCAG) dos temas.
- `node --check src/js/*.js` — valida a sintaxe dos módulos JS.
