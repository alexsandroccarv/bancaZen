# Changelog

Todas as mudanças notáveis deste projeto serão documentadas neste arquivo.

O formato é baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/),
e este projeto adere ao [Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [Não lançado]

### Removido
- "Currículos guardados no servidor": saem os campos PPG, instituição e
  situação. Os dados de cada pessoa vêm só das cargas (planilha de
  docentes); quem não está nela fica guardado sem dados, fora da busca.
  O comando `reindexar.php` mantém `--ppg`. [issue #47](../../issues/47)

## [0.0.23] - 2026-10-23

### Alterado
- Administração: "Lista de docentes" e "Currículos cadastrados" começam
  recolhidas e abrem pelo título, que mostra a contagem.
  [issue #45](../../issues/45)

## [0.0.22] - 2026-10-23

### Corrigido
- Planilha de docentes: o ID Lattes é lido como número
  (`1533188485721174`) ou link (`http://lattes.cnpq.br/1533188485721174`,
  também `https`, `www`, barra final e espaços), em qualquer coluna de Lattes
  (`lattes_id`, `lattes_url`, "ID Lattes", "Link do Lattes"...). Com as duas
  colunas, se divergirem, vale o link, e a divergência é informada; IDs em
  notação científica do Excel são apontados; número com mais de 16 dígitos
  não é recortado. CSV separado por tabulação também é aceito.
  [issue #43](../../issues/43)

## [0.0.21] - 2026-10-23

### Adicionado
- Administração: seção **Zona de risco** para limpar a base de dados.
  Escolha entre apagar os currículos (índice e todos os arquivos de `xml/`)
  e/ou a lista de docentes; a senha fica. O botão só é habilitado depois de
  digitar `LIMPAR` e pede confirmação; o servidor confere de novo (ação
  `limpar`, sessão + CSRF). [issue #41](../../issues/41)

## [0.0.20] - 2026-10-23

### Corrigido
- Leitura dos XMLs: quando um arquivo não é currículo Lattes, a mensagem diz
  o que ele contém (vazio, página HTML com título e texto, outro XML com o
  elemento principal, ou o início do arquivo). Passam a ser aceitos
  `CURRICULO-VITAE` com atributos de namespace (`xmlns:xsi`), conteúdo
  compactado com gzip e ZIP em base64 com extensão `.xml`.
  [issue #39](../../issues/39)

## [0.0.19] - 2026-10-23

### Corrigido
- Conferência: passa a contar todos os XMLs cujo ID Lattes não está na
  planilha de docentes (antes, só os sem PPG), informando quantos deles estão
  fora da busca por não terem PPG. [issue #37](../../issues/37)

## [0.0.18] - 2026-10-23

### Adicionado
- Planilha de docentes: coluna `email` opcional (também no modelo do CSV).
  O e-mail fica só na lista de docentes, na pasta de dados privada, e
  aparece só na Administração; e-mail inválido é ignorado e informado. Nunca
  sai nas sugestões públicas. [issue #35](../../issues/35)

## [0.0.17] - 2026-10-23

### Alterado
- "Cadastrar docentes e currículos" só com **Escolher arquivos** e
  **Escolher pasta**: saem os campos PPG, instituição, situação e a opção de
  substituir. Os dados vêm da planilha (linha sem PPG fica com PROFIAP), que
  substitui a lista de cada PPG que traz. Currículo de quem não está na
  planilha é guardado sem dados e fica fora da busca (e da contagem pública)
  até a planilha trazer a pessoa; a inclusão dos XMLs do servidor segue a
  mesma regra, sem descartar ninguém. [issue #33](../../issues/33)

### Adicionado
- Administração: área "Conferência: currículos e planilha", com quantos XMLs
  estão sem dados na planilha e quantos docentes da planilha ainda não têm
  XML, com as listas. [issue #33](../../issues/33)

## [0.0.16] - 2026-10-23

### Adicionado
- Administração: seção "Currículos guardados no servidor", com os botões
  **Simular** e **Incluir na busca** para os XML/ZIP copiados direto para a
  pasta de dados, PPG, instituição e situação para quem não está cadastrado
  nem na lista de docentes, e a opção de apagar as cópias com outro nome.
  Processa em lotes de 25 arquivos (ação `reindexar` de `api/admin.php`),
  com o progresso na tela. [issue #31](../../issues/31)

## [0.0.15] - 2026-10-23

### Adicionado
- Comando `php api/cli/reindexar.php`, no servidor: monta ou completa o índice
  da busca a partir dos XML/ZIP copiados direto para a pasta de dados (rsync,
  FTP), com a regra do mesmo ID. O programa vem do índice, da lista de
  docentes ou de `--ppg`; `--simular` mostra sem gravar e `--organizar` apaga
  as cópias com outro nome depois de gravadas. [issue #29](../../issues/29)

## [0.0.14] - 2026-10-23

### Corrigido
- Verificação do site a partir do servidor: todas as requisições usam uma só
  conexão SSH, porque a hospedagem recusa conexões seguidas. DEPLOY.md explica
  o 404 obtido também de dentro do servidor (`SITE_URL` diferente do endereço
  do site). [issue #27](../../issues/27)

## [0.0.13] - 2026-10-23

### Corrigido
- Verificação do site a partir do servidor: quando a requisição não tem
  resposta (HTTP 000), o log mostra o motivo (erro do `curl` ou da conexão
  SSH) e a requisição é repetida apontando o endereço para `127.0.0.1`, pois
  muitas hospedagens não deixam o servidor alcançar o próprio endereço
  público. Sem nenhuma resposta HTTP, a verificação é inconclusiva e só avisa;
  uma resposta de erro continua falhando. [issue #25](../../issues/25)

## [0.0.12] - 2026-10-23

### Corrigido
- Verificação do site depois do deploy: requisições com User-Agent de
  navegador e, se o site não responder aos executores do GitHub (bloqueio de
  IPs de data center pela hospedagem), a mesma verificação é refeita de dentro
  do servidor, pela conexão SSH do deploy; o log diz qual caminho funcionou e
  só há falha se o site não responder nem a partir do servidor. Corrige também
  argumentos com espaços nos comandos remotos do deploy (`printf %q`).
  [issue #23](../../issues/23)

## [0.0.11] - 2026-10-23

### Adicionado
- Minha Dissertação: campos **Meu nome** e **Minha universidade**. A
  universidade preenche o critério "Desconsiderar pessoas desta instituição"
  (sem sobrescrever o que a pessoa digitou); nome e universidade aparecem na
  conferência "Antes de buscar" e no título do resultado. Ficam só no
  navegador. [issue #21](../../issues/21)

## [0.0.10] - 2026-10-23

### Alterado
- Cadastro unificado na Administração: um só formulário recebe a lista de
  docentes (CSV) e os currículos (XML/ZIP), com PPG (obrigatório) e
  instituição e situação (opcionais; sem instituição, vale a do Lattes). Sai
  o campo "Grupo": a lista da banca vem do PPG, **PROFIAP → Rede PROFIAP** e
  qualquer outro PPG → **Externa**, inclusive para os dados já guardados (o
  "grupo" gravado antes é ignorado). Listas e tabelas com os rótulos Rede
  PROFIAP e Externa. [issue #19](../../issues/19)

## [0.0.9] - 2026-10-23

### Adicionado
- Modelo do arquivo CSV da lista de docentes na Administração: botão
  "Baixar modelo (CSV)" (separado por `;`, UTF-8 com BOM, gerado por
  `api/admin.php?acao=modelo-docentes`) e tabela com as colunas, a
  obrigatoriedade e exemplos. As linhas de exemplo (ID Lattes
  `0000000000000000`) são ignoradas na importação. [issue #17](../../issues/17)

## [0.0.8] - 2026-10-21

### Adicionado
- Lista de docentes dos programas: importação de CSV na Administração (ex.:
  "docentes PROFIAP 2025", 611 linhas, 608 pessoas), antes mesmo dos XMLs,
  com tabela que mostra quem já tem currículo enviado. Guarda só nome,
  universidade, PPG, situação no programa e Lattes, na pasta de dados
  privada; e-mails são descartados e a lista nunca é versionada. Mesma regra
  para PROFIAP e outros programas. As sugestões passam a exibir Nome,
  Universidade, PPG, Situação no programa e Link do Lattes; o envio de XML
  ganha o campo "Situação no programa". [issue #15](../../issues/15)

## [0.0.7] - 2026-10-21

### Alterado
- A aplicação foi dividida em seções, cada uma com um ícone na barra
  superior: **Início** (apresentação e explicação do funcionamento), **Minha
  Dissertação**, **Minha orientação**, **Bancas sugeridas** (conferência do
  que foi preenchido, critérios, busca e listas) e **Administração** (antes
  em `admin.html`, que agora redireciona para a seção). Endereço de cada
  seção na URL, botões "Próximo" entre as etapas e erros que levam à seção a
  corrigir. [issue #13](../../issues/13)

### Corrigido
- O deploy normaliza o `SSH_KEY` antes de usar (quebras de linha do Windows,
  espaços nas bordas, linhas em branco, chave colada numa linha só) e, se a
  chave continuar inválida, diz qual é o formato (PuTTY `.ppk`, chave
  pública, SSH2, incompleta) sem mostrar o conteúdo. [issue #12](../../issues/12)

## [0.0.6] - 2026-10-21

### Corrigido
- O deploy confere que a pasta de dados que o PHP vai usar (gravada pelo
  build) é a mesma que ele verificou; com `BANCAZEN_DADOS` criada só no
  ambiente `producao`, o PHP cairia no padrão dentro do `public_html` sem
  erro algum. [issue #10](../../issues/10)

## [0.0.5] - 2026-10-21

### Corrigido
- Deploy em hospedagem compartilhada (cPanel): o `deploy.sh` recusa pasta de
  dados dentro de pasta pública da web (`public_html`, `htdocs`,
  `www/html`), onde os currículos poderiam ser baixados, e orienta a definir
  `BANCAZEN_DADOS`; confere antes da conexão se o `SSH_KEY` é chave privada
  válida e sem senha, mostra a impressão digital da chave e explica as causas
  comuns de `Permission denied`. `DEPLOY.md` ganhou a seção de hospedagem
  compartilhada. [issue #8](../../issues/8)

## [0.0.4] - 2026-10-21

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
