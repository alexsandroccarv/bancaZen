# Checklist de Go-Live — versão 1.0.0

Estas são as tarefas **obrigatórias antes de lançar a versão 1.0.0** de um
projeto criado a partir deste template. Elas cobrem frentes que vão além do
código (jurídico, documentação ao usuário, suporte e infraestrutura) e
**não** são copiadas como issues quando se usa "Use this template" — por isso
ficam versionadas aqui.

## Como usar no novo repositório

- **Opção A (recomendada):** rode o workflow **Actions → "Semear issues de
  Go-Live (v1.0.0)" → Run workflow**. Ele cria as tarefas abaixo como issues
  (rótulo `go-live`), a partir de `.github/go-live-issues.json`. É idempotente
  (não duplica).
- **Opção B:** use este arquivo diretamente como checklist, marcando os itens
  conforme concluir.

Só marque a v1.0.0 (editando `VERSION` para `1.0.0`, ver `CONTRIBUTING.md`)
quando **todos** os itens estiverem concluídos.

---

## Jurídico e Compliance
- [ ] **Termos de Uso (ToS) e EULA** — redigir e publicar `termodeuso.html`
      (link já no rodapé). Revisão jurídica, foro/legislação, data de vigência.
- [ ] **Política de Privacidade (LGPD)** — redigir e publicar
      `politicadeprivacidade.html`. Mapear dados (incl. `localStorage`), base
      legal, DPO, direitos do titular.
- [ ] **Aviso de Licenças de Terceiros** — criar `THIRD-PARTY-NOTICES.md`
      (Tailwind, Font Awesome, fontes etc.), verificar compatibilidade de
      licenças e definir processo de atualização.

## Documentação para o Usuário Final
- [ ] **Quick Start + Manual do Usuário** — 1 página essencial + manual
      completo com capturas, em linguagem não técnica.
- [ ] **Release Notes da v1.0** — comunicado ao usuário (distinto do
      `CHANGELOG.md`), consistente com `VERSION`.

## Suporte e Operações
- [ ] **Base de Conhecimento (N1/N2)** — ≥ 10 artigos de troubleshooting,
      com critério de escalonamento.
- [ ] **SLA e Matriz de Escalonamento (N1/N2/N3)** — tempos por severidade,
      responsáveis, canais e on-call.

## Engenharia e Infraestrutura
- [ ] **Plano de Rollback** — critérios, passos técnicos, backup do
      `DEPLOY_PATH` antes do deploy, teste em homologação, RTO.
- [ ] **Plano de Recuperação de Desastres (DRP)** — backup e restauração
      completa, RTO/RPO, teste de restore registrado.

> Os critérios de aceite (DoD) completos de cada tarefa estão em
> `.github/go-live-issues.json` (e nas issues geradas por ele).
