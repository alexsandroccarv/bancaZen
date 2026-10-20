/* ==========================================================================
   templateZen — carregador de recursos externos (Tailwind + Font Awesome)
   --------------------------------------------------------------------------
   Carrega as CDNs de forma ASSÍNCRONA e tolerante a falha: se a CDN estiver
   lenta/bloqueada, a aplicação continua funcionando (o fallback em
   styles.css mantém a página legível). Fonte única usada por todas as
   páginas (index.html e páginas de apoio), evitando duplicar o TW_CONFIG.

   Ao trocar a identidade visual do projeto, ajuste as cores brand/accent
   abaixo em um único lugar.
   ========================================================================== */
(function () {
    // Fontes por tema (Google Fonts; Rawline via CDN gov.br). Carregadas sob
    // demanda quando o tema é selecionado. Padrão e GitHub usam a fonte do
    // sistema (sem carregar nada). As famílias correspondem às --tz-font em
    // styles.css.
    var G = 'https://fonts.googleapis.com/css2?family=';
    var THEME_FONTS = {
        'catppuccin-latte': G + 'Nunito:wght@400;600;700&display=swap',
        'catppuccin-mocha': G + 'Nunito:wght@400;600;700&display=swap',
        dracula: G + 'Fira+Sans:wght@400;600;700&display=swap',
        // gov.br usa a Rawline self-hospedada (src/fonts/rawline/ + @font-face
        // em styles.css), carregada pelo navegador sob demanda — sem CDN
        // externa. Por isso não há entrada 'govbr' aqui. GitHub Light/Dark
        // usam a fonte do sistema pelo mesmo motivo.
        'rose-pine-dawn': G + 'Quicksand:wght@400;600;700&display=swap',
        'solarized-dark': G + 'Source+Sans+3:wght@400;600;700&display=swap',
        'solarized-light': G + 'Source+Sans+3:wght@400;600;700&display=swap',
    };
    window.__loadThemeFont = function (preset) {
        var url = THEME_FONTS[preset];
        if (!url) return; // Padrão/GitHub: fonte do sistema
        if (document.querySelector('link[data-tz-font="' + preset + '"]')) return;
        var l = document.createElement('link');
        l.rel = 'stylesheet'; l.href = url; l.setAttribute('data-tz-font', preset);
        document.head.appendChild(l);
    };

    // (5) Sincroniza <meta name="theme-color"> (cor da barra do navegador no
    // mobile) com o cabeçalho do tema. Usa a --tz-header computada; sem tema,
    // cai no azul padrão da marca.
    window.__setThemeColor = function () {
        var m = document.querySelector('meta[name="theme-color"]');
        if (!m) { m = document.createElement('meta'); m.name = 'theme-color'; document.head.appendChild(m); }
        var c = getComputedStyle(document.documentElement).getPropertyValue('--tz-header').trim();
        m.setAttribute('content', c || '#1d4ed8');
    };

    // Tema pronto selecionado (gov.br, Dracula, Solarized…): aplica cedo,
    // antes da pintura, para evitar "flash" com o visual padrão. A chave é a
    // mesma de config.js (storageKeys.themePreset = 'temaPreset').
    try {
        // Tema padrão do template: gov.br (quando nada foi escolhido ainda).
        var tz = localStorage.getItem('temaPreset') || 'govbr';
        document.documentElement.classList.add('tz-theme');
        document.documentElement.setAttribute('data-tz-theme', tz);
        window.__loadThemeFont(tz);
    } catch (e) {
        document.documentElement.classList.add('tz-theme');
        document.documentElement.setAttribute('data-tz-theme', 'govbr');
    }
    window.__setThemeColor();

    var TW_CONFIG = {
        darkMode: 'class',
        theme: {
            extend: {
                fontFamily: { sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'] },
                colors: {
                    // Cor primária da marca (cabeçalho/rodapé).
                    brand:  { 50: '#eff6ff', 100: '#dbeafe', 400: '#60a5fa', 600: '#1d4ed8', 700: '#1e40af', 800: '#1e3a8a', 900: '#172554' },
                    // Cor de destaque (usada em detalhes no tema escuro).
                    accent: { 50: '#f0fdf4', 100: '#dcfce7', 400: '#4ade80', 600: '#16a34a', 700: '#15803d', 800: '#166534', 900: '#14532d' },
                }
            }
        }
    };
    var tw = document.createElement('script');
    tw.src = 'https://cdn.tailwindcss.com';
    tw.async = true;
    tw.onload = function () { try { window.tailwind.config = TW_CONFIG; } catch (e) {} };
    tw.onerror = function () { document.documentElement.classList.add('no-tailwind'); };
    document.head.appendChild(tw);

    var l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css';
    l.media = 'all';
    document.head.appendChild(l);
})();
