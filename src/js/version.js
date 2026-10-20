/* ==========================================================================
   templateZen — dados de build (fontes únicas: arquivo VERSION + data do build)
   --------------------------------------------------------------------------
   Expõe em `window` a versão e a data do build para que o rodapé
   (config.js -> #appVersion / #lastModDate) reflita AUTOMATICAMENTE:
   - `__APP_VERSION`   : número mantido em `VERSION` (bump automático na CI);
   - `__APP_BUILD_DATE`: data em que o `build.mjs` montou o `dist/`.

   Em produção, o `build.mjs` SOBRESCREVE este arquivo no `dist/` com os
   valores reais. Em desenvolvimento local (abrindo `src/` direto, sem
   build), ficam `null` e o rodapé usa os fallbacks definidos em `config.js`.
   ========================================================================== */
window.__APP_VERSION = null;
window.__APP_BUILD_DATE = null;
