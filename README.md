# bancaZen

Aplicação web que indica **membros externos para banca de defesa de
mestrado** a partir de currículos Lattes.

1. Na seção **Administração**, um formulário único recebe a **lista de
   docentes** (planilha CSV com nome, universidade, situação no programa,
   PPG, Lattes e, opcionalmente, e-mail, visível só na Administração) e os **currículos** (XML exportado
   pela Plataforma Lattes, ou o ZIP que o contém), só com a escolha dos
   arquivos ou da pasta: os dados de cada pessoa vêm da planilha, pelo ID
   Lattes. Currículo de quem não está na planilha fica guardado sem dados e
   fora da busca; a conferência mostra esses currículos e os docentes da
   planilha ainda sem XML. A lista da banca vem do PPG:
   **PROFIAP → Rede PROFIAP**; qualquer outro PPG → **Externa**.
2. Se o mesmo ID Lattes já existir, fica o currículo com a data de
   atualização mais recente. A tabela de docentes mostra quem ainda não tem
   currículo enviado.
3. A página principal é dividida em seções, com ícones na barra superior:
   **Início** (apresentação e funcionamento), **Minha Dissertação** (com
   **Minha orientação**, opcional, e botões para exportar e importar os dados
   num arquivo JSON), **Bancas sugeridas** e **Administração**. A pessoa discente
   informa **nome**, **universidade** (pessoas da mesma instituição são
   desconsideradas como membro externo), **título**, **resumo** e
   **palavras-chave** do trabalho e, opcionalmente, o próprio
   currículo Lattes e o da orientação, e recebe **duas listas de até 10 pessoas** com maior
   proximidade temática, numa escala de **0 a 1**, em ordem decrescente:
   - **Rede PROFIAP** (docentes do PPG PROFIAP);
   - **Externa** (docentes de outros PPGs, para o segundo membro externo).
   Cada pessoa aparece com **Nome, Universidade, PPG, Situação no programa e
   Link do Lattes** (da lista de docentes, quando a pessoa está nela), além
   de titulação, bancas de mestrado registradas e os termos em comum.

**Proteção dos currículos.** Os XML e o índice processado ficam no servidor,
numa pasta de dados fora da área pública do site (ver
[DEPLOY.md](DEPLOY.md#passo-1-pastas-no-servidor)). O navegador recebe só
o resultado da busca. Os currículos da pessoa discente e da orientação
enviados na busca são lidos em memória e não são gravados. Nenhum currículo
é versionado no repositório.

**Conformidade ética.** Quem tem coautoria em publicações (procurada nos
currículos dos dois lados), relação de orientação com a pessoa discente, o(a)
orientador(a) ou o(a) coorientador(a), ou é uma dessas pessoas, sai da lista
e aparece à parte, com o motivo. O vínculo é "confirmado" quando a pessoa é
identificada pelo ID Lattes ou pelo nome completo, e "provável" quando só o
sobrenome e as iniciais coincidem (pode ser homônimo). O período das
coautorias é configurável (todo o período, 10 ou 5 anos). A etapa "Minha
orientação" é opcional: o resultado mostra quem foi considerado na
verificação ou avisa que ela não foi feita.

**Como a proximidade é calculada.** Cada currículo vira um conjunto de termos
(resumo, linhas de pesquisa, áreas do conhecimento, palavras-chave, títulos
da formação, dos projetos, dos artigos e demais produções, das orientações e
das bancas de mestrado, doutorado e qualificação de que a pessoa participou),
com pesos por campo (artigos e bancas acima das demais produções) e peso
menor para produções com mais de 10 anos. O trabalho informado
vira a consulta (palavras-chave e título pesam mais que o resumo). Os
termos passam por remoção de acentos e de palavras vazias, radical leve e
bigramas; a pontuação é BM25 (IDF, saturação da frequência e ajuste ao
tamanho do currículo), e a proximidade (0 a 1) é a pontuação dividida pelo
máximo que a consulta poderia alcançar. Filtros opcionais: desconsiderar a instituição do programa
e manter só doutores.

**Código.** Backend em PHP 8 sem dependências, em `src/api/`:
`lib/lattes.php` (extrator, schema `CurriculoLattes`, o mesmo do
[lattesZen](https://github.com/alexsandroccarv/latteszen)),
`lib/similaridade.php`, `lib/vinculos.php`, `lib/base.php` (pasta de dados,
sessão) e os endpoints `buscar.php`, `status.php` e `admin.php`. Interface:
`src/js/app.js` e `src/js/admin.js`. Teste: `php tools/testar.php`.
Ambiente local: `node build.mjs && php -S localhost:8000 -t dist` (dados em
`bancazen-dados/`, ignorada pelo Git).

**Integração contínua e publicação.** Todo push e pull request passa pela
validação (`bash .github/scripts/validar.sh`: sintaxe JS e PHP, testes do
backend, contraste, build). Na `main`, depois do incremento automático de
versão, o site é publicado por rsync/SSH, com verificações no servidor antes
da cópia e no site depois dela. Configuração em [DEPLOY.md](DEPLOY.md).

---

O restante deste documento descreve a base herdada do modelo **templateZen**
(cabeçalho, rodapé, temas, CI/CD).

## O que vem pronto

- **Cabeçalho** com logo, nome do app, selo opcional (sigla), logo
  secundário opcional, abas de navegação e **engrenagem de Configurações**
  (no topo à direita, em todas as páginas).
- **Rodapé** com versão e data (automáticas), links (termo de uso,
  privacidade, ajuda, sobre, doe um café, histórico), alto contraste,
  escala de fonte e créditos (autor, doe um café, licença).
- **9 temas prontos** selecionáveis em Configurações — **gov.br (padrão)**,
  Catppuccin Latte/Mocha, Drácula, GitHub Light/Dark, Rosé Pine Dawn e
  Solarized Light/Dark — cada um com **cores e fonte próprias** e contraste
  **WCAG AA** garantido por script (`tools/contrast-check.mjs`). Aplicados
  cedo (sem "flash") e persistidos em `localStorage`, sem depender da CDN
  do Tailwind carregar.
- **Acessibilidade**: skip link, foco visível, landmarks, um `<h1>` por
  página, `prefers-reduced-motion`, alto contraste e escala de fonte.
- **Cabeçalho/rodapé compartilhados** (`js/chrome.js`, fonte única) e
  **páginas de apoio** prontas (termo, privacidade, ajuda, sobre, doe um
  café com PIX, histórico) + página **404**.
- **Tailwind e Font Awesome via CDN** (`js/cdn.js`), assíncronos e
  tolerantes a falha (fallback mínimo em `styles.css`). **Favicon** sempre
  o logo do projeto em SVG.
- **SEO/social**: `meta description`, Open Graph/Twitter e `canonical` com
  URLs absolutas (variável `SITE_URL`), `robots.txt` e `sitemap.xml`
  gerado no build.
- **CI/CD via SSH** (GitHub Actions): valida em todo push e pull request e,
  na `main`, publica via `rsync` depois do incremento de versão; veja
  [DEPLOY.md](DEPLOY.md).
- **Versionamento**: arquivo `VERSION` (SemVer) com `PATCH` automático a
  cada `push` em `main`, e `CHANGELOG.md` no formato
  [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).
- **Setup do novo projeto** em um comando (`node scripts/setup.mjs`) e
  scaffolding de colaboração (PR/issue templates, `CONTRIBUTING`, `SECURITY`,
  `CODE_OF_CONDUCT`) e de higiene (`.editorconfig`, `.gitattributes`,
  `.nvmrc`).
- **Componentes React** (`src/components/`) equivalentes ao cabeçalho e
  rodapé, com as mesmas classes Tailwind e chaves de `localStorage`.

## Estrutura de arquivos

```
templatezen/
├── LICENSE
├── README.md
├── DEPLOY.md                    # Como configurar a publicação via SSH
├── CLAUDE.md                    # Regras e convenções do projeto (fase 2)
├── CHANGELOG.md                 # Histórico de versões (Keep a Changelog)
├── VERSION                      # Versão atual (SemVer), ex.: 0.0.0
├── build.mjs                    # Monta dist/ (injeta versão/data, SITE_URL, sitemap)
├── CONTRIBUTING.md              # Fluxo de contribuição
├── CODE_OF_CONDUCT.md
├── SECURITY.md
├── .editorconfig / .gitattributes / .nvmrc   # Higiene do repositório
├── scripts/
│   └── setup.mjs                # Troca os placeholders do template de uma vez
├── tools/
│   └── contrast-check.mjs       # Auditoria de contraste (WCAG) dos temas
├── .github/
│   ├── workflows/
│   │   ├── validar.yml          # CI: valida em todo push/PR (e antes do deploy)
│   │   ├── deploy.yml           # Publica após o version-bump (rsync/SSH)
│   │   ├── version-bump.yml     # Incrementa o PATCH de VERSION automaticamente
│   │   └── seed-go-live-issues.yml  # Cria as tarefas de Go-Live (v1.0.0) no repo
│   ├── scripts/
│   │   ├── validar.sh           # Validação (CI e local)
│   │   ├── deploy.sh            # Verificações no servidor + rsync sobre SSH
│   │   └── verificar-site.sh    # Teste do site publicado
│   ├── go-live-issues.json      # Tarefas obrigatórias antes da v1.0.0 (manifesto)
│   ├── pull_request_template.md
│   └── ISSUE_TEMPLATE/
│       ├── feature.md           # Sugestão de funcionalidade
│       ├── bug.md               # Relato de bug
│       └── config.yml           # Configuração do seletor de issues
├── docs/
│   └── GO-LIVE-1.0.md           # Checklist de Go-Live (pré-1.0.0)
└── src/
    ├── index.html        # Página principal (cabeçalho, abas, rodapé)
    ├── termodeuso.html   # Páginas de apoio (replicam cabeçalho/rodapé via chrome.js)
    ├── politicadeprivacidade.html
    ├── ajuda.html
    ├── sobre.html
    ├── doeumcafe.html
    ├── historico.html
    ├── 404.html          # Página de erro
    ├── robots.txt        # SEO (referencia o sitemap.xml gerado no build)
    ├── logo.svg          # Logo do projeto — usado como favicon (troque pela sua marca)
    ├── css/
    │   └── styles.css    # Estilos de apoio, fallback sem Tailwind e paletas dos temas
    ├── fonts/
    │   └── rawline/      # Fonte Rawline (gov.br) self-hospedada (100–900)
    ├── js/
    │   ├── config.js     # Dados do app (nome, links, autor, licença, chaves)
    │   ├── version.js    # Versão (do VERSION) e data do build (preenchidos pelo build)
    │   ├── cdn.js        # Tailwind/Font Awesome + cores da marca + tema/fonte cedo
    │   ├── chrome.js     # Cabeçalho/rodapé compartilhados (fonte única)
    │   └── layout.js     # Lógica: tema, alto contraste, fonte, abas, nome, temas
    └── components/
        ├── Header.jsx    # Cabeçalho padrão (versão React)
        └── Footer.jsx    # Rodapé padrão (versão React, mesma lógica de layout.js)
```

## Como usar em um novo projeto

1. Gere seu repositório a partir deste template (botão **Use this template**
   no GitHub) ou copie os arquivos para o novo projeto.
2. **Rode o setup** para trocar os placeholders de uma vez:
   ```bash
   node scripts/setup.mjs
   ```
   Ele pergunta (e atualiza) **nome do app**, **repositório**, **autor**,
   **licença** e **cor da marca** — mexendo em `config.js`, `cdn.js`,
   `index.html` e no template de issues. Também dá para passar por flags,
   ex.: `node scripts/setup.mjs --name="Meu App" --brand=#e11d48`.
   Prefere manual? Edite `src/js/config.js` (`name`, `org.sigla`, `author`,
   `repo`, `license`, `links`) e as cores `brand`/`accent` do `TW_CONFIG` em
   `src/js/cdn.js`. A **versão** e a **data** do rodapé são automáticas (do
   `VERSION` e da data do build) — não edite à mão.
3. Ajustes visuais em `src/`:
   - Troque `src/logo.svg` pela sua marca (mantendo o nome): é o **favicon**.
   - Se não precisar de logo secundário, remova o bloco `#secondaryLogo`.
   - Adicione/remova botões `.tab-btn` (com `data-tab="nome"`) e o
     `<div id="tab-nome" class="tab-panel">` correspondente em `<main>`.
   - Escolha o tema padrão em Configurações (padrão de fábrica: **gov.br**);
     para mudar o default no código, veja `THEME_DEFAULT` em `js/layout.js`
     e o fallback em `js/cdn.js`.
4. Adicione os scripts específicos da sua aplicação **depois** de
   `js/layout.js` em `index.html`. `layout.js` dispara o evento
   `tab:change` (`document.addEventListener('tab:change', ...)`) sempre
   que a aba ativa muda, e expõe `window.Layout.switchTab(nome)` para
   trocar de aba via código.
5. Edite as páginas de apoio em `src/` (`termodeuso.html`,
   `politicadeprivacidade.html`, `ajuda.html`, `sobre.html`,
   `doeumcafe.html`, `historico.html`) com o conteúdo do seu projeto — elas
   já replicam o cabeçalho/rodapé via `js/chrome.js`. Para adicionar/remover
   itens do rodapé, ajuste `config.links` e o `footerHTML()` em
   `js/chrome.js`.
6. Para publicar automaticamente via SSH a cada `push`, siga o passo a
   passo em [DEPLOY.md](DEPLOY.md) (chave SSH dedicada + secrets no
   GitHub). Antes dos secrets configurados, o workflow só valida e monta
   `dist/` — fica verde sem publicar. Defina também a variável `SITE_URL`
   (Actions → Variables) para as metatags sociais e o `sitemap.xml` saírem
   com URLs absolutas.
7. Se o seu projeto for React (Vite, Next etc.), use `src/components/
   Header.jsx` e `Footer.jsx` em vez de `src/index.html`/`layout.js` —
   eles recebem os mesmos dados de `config.js` via props (veja o
   comentário JSDoc no topo de cada arquivo).
8. `VERSION` começa em `0.0.0` e é incrementado (`PATCH`) automaticamente
   a cada push em `main` pelo workflow `version-bump.yml`. Registre as
   mudanças notáveis em `CHANGELOG.md` conforme for lançando versões.

## Antes de lançar a 1.0.0

Um projeto criado a partir deste template tem tarefas de **Go-Live** que vão
além do código (jurídico, documentação ao usuário, suporte e infraestrutura).
Elas estão em [docs/GO-LIVE-1.0.md](docs/GO-LIVE-1.0.md). Como issues não são
copiadas pelo "Use this template", rode uma vez, no novo repositório, o
workflow **Actions → "Semear issues de Go-Live (v1.0.0)"** — ele cria essas
tarefas como issues (rótulo `go-live`) a partir de
`.github/go-live-issues.json`. Conclua todas antes de subir o `VERSION` para
`1.0.0`.

## Contribuindo

O fluxo de contribuição (Issue → branch → PR com `Closes #`) está descrito em
[CONTRIBUTING.md](CONTRIBUTING.md). Veja também o
[Código de Conduta](CODE_OF_CONDUCT.md) e a
[Política de segurança](SECURITY.md).

## Licença

Este template é distribuído sob a licença indicada em [LICENSE](LICENSE).
