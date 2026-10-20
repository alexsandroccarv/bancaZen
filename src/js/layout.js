/* ==========================================================================
   templateZen — lógica do cabeçalho/rodapé (tema, alto contraste, escala de
   fonte e navegação por abas). Genérico e reaproveitável entre projetos.
   ========================================================================== */
(function () {
    const $ = (sel, ctx) => (ctx || document).querySelector(sel);
    const $$ = (sel, ctx) => Array.from((ctx || document).querySelectorAll(sel));

    /* Acesso tolerante ao localStorage: em aba anônima, com storage
       bloqueado ou cota estourada o acesso pode lançar exceção — aqui a
       aplicação apenas segue sem persistir, em vez de quebrar. */
    const store = {
        get(key, fallback = null) {
            try { const v = localStorage.getItem(key); return v === null ? fallback : v; }
            catch (e) { return fallback; }
        },
        set(key, value) {
            try { localStorage.setItem(key, value); } catch (e) { /* storage indisponível */ }
        },
        remove(key) {
            try { localStorage.removeItem(key); } catch (e) { /* storage indisponível */ }
        },
    };

    /* =====================================================================
       Navegação por abas
       ===================================================================== */
    function switchTab(name, opts) {
        const focus = opts && opts.focus;
        $$('.tab-btn').forEach(b => {
            const active = b.dataset.tab === name;
            b.setAttribute('aria-selected', active ? 'true' : 'false');
            // Roving tabindex: só a aba ativa é tabulável (padrão ARIA tablist).
            b.tabIndex = active ? 0 : -1;
            if (active && focus) b.focus();
        });
        $$('.tab-panel').forEach(p => { p.hidden = (p.id !== 'tab-' + name); });
        document.dispatchEvent(new CustomEvent('tab:change', { detail: { tab: name } }));
    }

    function wireTabs() {
        const btns = $$('.tab-btn');
        btns.forEach((b, i) => {
            b.addEventListener('click', () => switchTab(b.dataset.tab));
            // Navegação por teclado (setas/Home/End), esperada em um tablist.
            b.addEventListener('keydown', (e) => {
                let next = -1;
                if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % btns.length;
                else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + btns.length) % btns.length;
                else if (e.key === 'Home') next = 0;
                else if (e.key === 'End') next = btns.length - 1;
                if (next >= 0) { e.preventDefault(); switchTab(btns[next].dataset.tab, { focus: true }); }
            });
        });
        const initial = $('.tab-btn[aria-selected="true"]') || btns[0];
        if (initial) switchTab(initial.dataset.tab);
    }

    /* =====================================================================
       Rodapé: tema, alto contraste e escala de fonte
       ===================================================================== */
    function wireFooterToggles() {
        const htmlEl = document.documentElement;
        const keys = window.APP_CONFIG.storageKeys;

        const hc = $('#highContrastToggle');
        if (hc) {
            const syncHC = () => hc.setAttribute('aria-pressed', htmlEl.classList.contains('high-contrast') ? 'true' : 'false');
            syncHC();
            hc.addEventListener('click', () => {
                htmlEl.classList.toggle('high-contrast');
                store.set(keys.highContrast, htmlEl.classList.contains('high-contrast') ? '1' : '0');
                syncHC();
            });
        }

        // Escala de fonte (acessibilidade): 80%-150%, passo de 10%.
        const FS_MIN = 80, FS_MAX = 150, FS_STEP = 10;
        const getFS = () => { const n = parseInt(store.get(keys.fontScale, '100'), 10); return isNaN(n) ? 100 : n; };
        const applyFS = (n) => {
            n = Math.max(FS_MIN, Math.min(FS_MAX, n));
            htmlEl.style.fontSize = n === 100 ? '' : n + '%';
            store.set(keys.fontScale, String(n));
            const dec = $('#fontDec'), inc = $('#fontInc');
            if (dec) dec.disabled = n <= FS_MIN;
            if (inc) inc.disabled = n >= FS_MAX;
        };
        applyFS(getFS());
        const dec = $('#fontDec'), inc = $('#fontInc');
        if (dec) dec.addEventListener('click', () => applyFS(getFS() - FS_STEP));
        if (inc) inc.addEventListener('click', () => applyFS(getFS() + FS_STEP));
    }

    /* =====================================================================
       Nome definido pelo usuário (aba Configurações -> cabeçalho "| nome")
       ===================================================================== */
    function wireUserName() {
        const keys = window.APP_CONFIG.storageKeys || {};
        const storageKey = keys.userName || 'nome';
        const input = $('#userNameInput');
        const nameEl = $('#headerUserName');
        const sepEl = $('#headerUserNameSep');

        const render = (value) => {
            const v = (value || '').trim();
            if (nameEl) { nameEl.textContent = v; nameEl.classList.toggle('hidden', !v); }
            if (sepEl) sepEl.classList.toggle('hidden', !v);
        };

        const saved = store.get(storageKey, '') || '';
        if (input) input.value = saved;
        render(saved);

        if (input) {
            input.addEventListener('input', () => {
                store.set(storageKey, input.value);
                render(input.value);
            });
        }
    }

    /* =====================================================================
       Tema: paletas prontas (gov.br, Dracula, Solarized…) escolhidas
       em Configurações. Aplica a classe .tz-theme + data-tz-theme no <html>;
       as cores em si vivem no styles.css (paletas por data-tz-theme).
       ===================================================================== */
    const THEME_DEFAULT = 'govbr';

    function applyTheme(preset) {
        const html = document.documentElement;
        html.setAttribute('data-tz-theme', preset || THEME_DEFAULT);
        html.classList.add('tz-theme');
        if (typeof window.__loadThemeFont === 'function') window.__loadThemeFont(preset || THEME_DEFAULT);
        if (typeof window.__setThemeColor === 'function') window.__setThemeColor();
    }

    function wireTheme() {
        const keys = window.APP_CONFIG.storageKeys || {};
        // Tema padrão do template: gov.br (usado quando nada foi escolhido).
        const saved = store.get(keys.themePreset, THEME_DEFAULT);
        applyTheme(saved);

        const sel = $('#themeSelect');
        if (sel) {
            sel.value = saved;
            sel.addEventListener('change', () => {
                store.set(keys.themePreset, sel.value);
                applyTheme(sel.value);
            });

            // Carrega as fontes de todas as opções (para a prévia no dropdown)
            // só quando a aba Configurações é aberta.
            if (typeof window.__loadThemeFont === 'function') {
                let loaded = false;
                const loadPreviews = () => {
                    if (loaded) return;
                    loaded = true;
                    Array.from(sel.options).forEach(o => window.__loadThemeFont(o.value));
                };
                document.addEventListener('tab:change', (e) => {
                    if (e.detail && e.detail.tab === 'config') loadPreviews();
                });
                const panel = $('#tab-config');
                if (panel && !panel.hidden) loadPreviews();
            }
        }
    }

    /* =====================================================================
       Preenche cabeçalho/rodapé com dados de APP_CONFIG
       ===================================================================== */
    function applyConfig() {
        const cfg = window.APP_CONFIG || {};
        const sigla = (cfg.org && cfg.org.sigla) || '';

        const baseTitle = sigla ? `${cfg.name} - ${sigla}` : (cfg.name || '');
        // Páginas de apoio podem definir <body data-page-title="..."> para
        // compor o título (ex.: "MeuApp — Termo de uso").
        const pageTitle = (document.body && document.body.dataset && document.body.dataset.pageTitle) || '';
        document.title = pageTitle ? `${baseTitle} — ${pageTitle}` : baseTitle;

        const nameEl = $('#headerAppName');
        if (nameEl) nameEl.textContent = cfg.name || '';

        const siglaEl = $('#headerSigla');
        if (siglaEl) {
            siglaEl.textContent = sigla;
            siglaEl.previousElementSibling && siglaEl.previousElementSibling.classList.toggle('hidden', !sigla);
            siglaEl.classList.toggle('hidden', !sigla);
        }

        const versionEl = $('#appVersion');
        if (versionEl) versionEl.textContent = cfg.version || '';
        const lastModEl = $('#lastModDate');
        if (lastModEl) lastModEl.textContent = cfg.lastModified || '';

        const termsEl = $('#footerTermsLink');
        if (termsEl && cfg.links) termsEl.href = cfg.links.termsOfUse || termsEl.href;
        const privacyEl = $('#footerPrivacyLink');
        if (privacyEl && cfg.links) privacyEl.href = cfg.links.privacyPolicy || privacyEl.href;
        const helpEl = $('#footerHelpLink');
        if (helpEl && cfg.links) helpEl.href = cfg.links.help || helpEl.href;
        const aboutEl = $('#footerAboutLink');
        if (aboutEl && cfg.links) aboutEl.href = cfg.links.about || aboutEl.href;
        const coffeeEl = $('#footerCoffeeLink');
        if (coffeeEl && cfg.links) coffeeEl.href = cfg.links.coffee || coffeeEl.href;
        const historyEl = $('#footerHistoryLink');
        if (historyEl && cfg.links) historyEl.href = cfg.links.changelog || historyEl.href;

        const authorEl = $('#footerAuthorLink');
        if (authorEl && cfg.author) {
            authorEl.href = cfg.author.github || authorEl.href;
            const label = $('#footerAuthorName', authorEl);
            if (label) label.textContent = cfg.author.nome || '';
        }
        const licenseEl = $('#footerLicenseLink');
        if (licenseEl && cfg.license) {
            licenseEl.href = cfg.license.url || licenseEl.href;
            licenseEl.title = cfg.license.nome ? `Licença ${cfg.license.nome}` : licenseEl.title;
            const label = $('#footerLicenseName', licenseEl);
            if (label) label.textContent = cfg.license.nome || '';
        }
    }

    function init() {
        applyConfig();
        wireFooterToggles();
        wireUserName();
        wireTheme();
        wireTabs();
        // Engrenagem no cabeçalho abre o painel de Configurações.
        const cfgBtn = $('#headerConfigBtn');
        if (cfgBtn) cfgBtn.addEventListener('click', () => switchTab('config'));
        // Vindo de outra página via engrenagem (index.html#config): abre a aba.
        if (window.location.hash === '#config' && $('#tab-config')) switchTab('config');
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    window.Layout = { switchTab };
})();
