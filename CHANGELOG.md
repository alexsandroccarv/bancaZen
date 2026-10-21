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
  Projeto renomeado para **bancaZen**. [issue #1](../../issues/1)
- Conformidade ética: a pessoa discente informa o próprio Lattes e o da
  orientação (orientador(a) obrigatório, coorientador(a) opcional), por
  arquivo XML/ZIP ou link/ID de currículo já na base. Pessoas com coautoria
  em publicações (procurada nos dois currículos), relação de orientação ou
  que sejam a própria envolvida saem da lista e aparecem à parte com o
  motivo, e a lista é completada com as próximas sem vínculo. Identificação
  "confirmada" (ID Lattes ou nome completo) ou "provável" (sobrenome e
  iniciais); período de coautoria configurável. Novo `src/js/vinculos.js`.
  [issue #2](../../issues/2)
- Área de administração (`admin.html`, com senha) para enviar currículos
  Lattes (XML, ZIP ou pasta), listar, corrigir e remover; com o mesmo ID
  Lattes, fica o currículo de data de atualização mais recente. Backend em
  PHP (`src/api/`): extrator, proximidade e vínculos passam a rodar no
  servidor, e os XML e o índice ficam numa pasta de dados fora da área
  pública; o navegador recebe só o resultado. [issue #3](../../issues/3)
- No envio, a administração informa grupo (PROFIAP ou outro programa), PPG e
  instituição; o resultado mostra duas listas de até 10 pessoas (PROFIAP e
  outros programas, para o segundo membro externo), com PPG e instituição.
  [issue #4](../../issues/4)

- Integração contínua: validação (`validar.yml` e
  `.github/scripts/validar.sh`, que também roda localmente) em todo push e
  pull request; o deploy passa a rodar depois do incremento de versão, com
  verificações no servidor (PHP, pasta de dados, senha), proteção da pasta
  de dados, de `.well-known/` e de `.user.ini`, recusa de pasta alheia no
  primeiro deploy, `SSH_KNOWN_HOSTS` opcional, ambiente `producao` e teste
  do site publicado (`verificar-site.sh`). Variável opcional
  `BANCAZEN_DADOS`. `admin.html` fora do `sitemap.xml` e do `robots.txt`.
  [issue #5](../../issues/5)
- Projeto renomeado de **BuscaBanca** para **bancaZen**, acompanhando o
  repositório (`alexsandroccarv/bancaZen`, antes `profiap_buscabanca`):
  nome da aplicação, endereço do repositório no rodapé e nos links das
  issues, pasta de dados `bancazen-dados`, variável `BANCAZEN_DADOS` e
  marcador `.bancazen-deploy`. [issue #6](../../issues/6)

### Removido
- Pasta `lattes/` no repositório, processamento dos currículos no build
  (`dist/data/corpus.json`) e a aba pública **Currículos** com leitura de
  arquivos no navegador: os currículos não ficam mais expostos.
  [issue #3](../../issues/3)

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
