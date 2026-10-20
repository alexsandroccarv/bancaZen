# Projeto: templateZen

## Visão geral
Template reutilizável de cabeçalho, rodapé, estrutura de arquivos e CI/CD
(build + deploy via SSH) para começar novos projetos web a partir de uma
base pronta.

## Padrões de UI
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

## Deploy
- Automático via rsync/ssh quando há merge na `main` (ver `.github/workflows/deploy.yml`)
- Segredos usados: `SSH_KEY`, `SSH_HOST`, `SSH_USER`, `SSH_PORT`, `DEPLOY_PATH`
- Variável: `SITE_URL` (Actions → Variables) — usada pelo `build.mjs` para
  URLs absolutas (Open Graph/canonical) e para gerar o `sitemap.xml`.

## Comandos úteis
- `node build.mjs` — monta a pasta `dist/` a partir de `src/` (injeta
  versão/data, substitui `%SITE_URL%` e gera `sitemap.xml`).
- `node scripts/setup.mjs` — setup do novo projeto (placeholders).
- `node tools/contrast-check.mjs` — audita o contraste (WCAG) dos temas.
- `node --check src/js/*.js` — valida a sintaxe dos módulos JS.
- (sem suíte de testes de comportamento configurada ainda)
