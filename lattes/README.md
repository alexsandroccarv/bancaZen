# Currículos Lattes

Coloque aqui os currículos que a aplicação deve considerar ao indicar
membros externos de banca:

- o **XML** exportado pela Plataforma Lattes (`curriculo.xml`), ou
- o **ZIP** que a Plataforma Lattes entrega (contém o `curriculo.xml`).

Subpastas são aceitas. Para exportar: no currículo do Lattes, menu
**Exportar → XML**.

A cada `node build.mjs` (e a cada deploy na `main`), todos os arquivos desta
pasta são processados e o resultado vai para `dist/data/corpus.json`, que a
página carrega. Se o mesmo currículo aparecer em mais de um arquivo, vale a
versão com a data de atualização mais recente. Arquivos inválidos são
ignorados com um aviso no log do build.

Dados de contato (e-mail, telefone, endereço) não são extraídos. Para trocar
um currículo, basta substituir o arquivo e publicar de novo.
