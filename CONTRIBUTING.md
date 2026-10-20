# Como contribuir

Obrigado por contribuir com o **templateZen**! Este projeto segue um fluxo
simples, orientado a issues.

## Fluxo de trabalho (Git)

1. **Abra uma Issue** antes de qualquer código — descrevendo a funcionalidade
   ou o bug (use os modelos em *New issue*).
2. **Crie um branch** a partir da issue:
   `issue-<numero>-descricao-curta` (ex.: `issue-42-ajuste-rodape`).
3. **Implemente e teste** localmente:
   - `node build.mjs` — monta o `dist/` a partir de `src/`.
   - `node --check src/js/*.js` — valida a sintaxe dos módulos JS.
4. **Registre no `CHANGELOG.md`** as mudanças notáveis, referenciando o número
   da issue (formato [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/)).
5. **Abra um Pull Request** com `Closes #<numero>` na descrição (o modelo de PR
   já traz o campo). A issue fecha automaticamente ao mergear.
6. Ao mergear na `main`, a CI:
   - incrementa o **PATCH** do arquivo `VERSION` (`version-bump.yml`);
   - **publica** o site via SSH, se os segredos estiverem configurados
     (`deploy.yml` — veja `DEPLOY.md`).

## Versionamento (SemVer)

- **PATCH**: automático a cada merge na `main` — **não** edite `VERSION` à mão.
- **MINOR/MAJOR**: alteração manual do `VERSION`, em um PR separado, quando
  houver uma mudança maior (decisão humana).

## Padrões

- **UI**: reutilize o cabeçalho/rodapé compartilhados (`src/js/chrome.js`) e a
  lógica de `src/js/layout.js`. Não recrie esses componentes.
- **Favicon**: sempre o logo do projeto em SVG (`src/logo.svg`).
- **Temas**: novas paletas seguem o contrato de variáveis `--tz-*` em
  `src/css/styles.css`; mantenha o contraste (WCAG AA).
- **Acessibilidade**: preserve landmarks, foco visível, rótulos (`aria-label`)
  e a hierarquia de headings (um `<h1>` por página).
- **Código**: siga o estilo dos arquivos vizinhos (indentação de 4 espaços,
  ver `.editorconfig`).

## Reportando vulnerabilidades

Não abra issue pública para falhas de segurança — veja o `SECURITY.md`.
