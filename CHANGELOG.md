# Changelog

Todas as mudanças notáveis deste projeto serão documentadas neste arquivo.

O formato é baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/),
e este projeto adere ao [Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [Não lançado]

### Adicionado
- Indicação de membros externos para banca de defesa de mestrado a partir de
  currículos Lattes: os XML (ou ZIP exportados pela Plataforma Lattes) da
  pasta `lattes/` são processados no build (`dist/data/corpus.json`); a
  pessoa usuária informa título, resumo e palavras-chave e a aplicação lista
  as 10 pessoas com maior proximidade temática (TF-IDF com cosseno, de 0 a 1),
  em ordem decrescente, com os termos em comum. Filtros para desconsiderar a
  instituição do programa e manter só doutores. Aba **Currículos** para
  conferir os currículos e acrescentar XML/ZIP do computador (lidos só no
  navegador). Teste em `tools/testar-similaridade.mjs`, executado na CI.
  Projeto renomeado para **BuscaBanca**. [issue #1](../../issues/1)

### Alterado
- Seção de temas reorganizada: de 16 paletas + "Padrão" para 9 temas
  nomeados — Catppuccin Latte, Catppuccin Mocha, Drácula, GitHub Light,
  GitHub Dark, gov.br (novo padrão, no lugar de Drácula), Rosé Pine Dawn,
  Solarized Light e Solarized Dark — com cores oficiais de cada paleta e
  contraste WCAG AA verificado (`tools/contrast-check.mjs`). Removida a
  lógica legada de tema claro/escuro (`html.dark`, chave `localStorage`
  `tema`) que ficara órfã e podia conflitar visualmente com o tema
  selecionado. [issue #12](../../issues/12)

## [0.0.1] - Base inicial

### Adicionado
- Estrutura inicial do projeto a partir do modelo **templateZen**:
  cabeçalho/rodapé compartilhados (`src/js/chrome.js`), 16 temas + "Padrão"
  (WCAG AA), páginas de apoio, build (`build.mjs`) e CI/CD (deploy via SSH,
  auto-bump do PATCH). As próximas mudanças serão documentadas aqui,
  referenciando o número da issue.
