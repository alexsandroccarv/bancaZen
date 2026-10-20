/* ==========================================================================
   templateZen — Configuração global da aplicação
   Edite este arquivo para adaptar o cabeçalho/rodapé ao seu projeto.
   ========================================================================== */
window.APP_CONFIG = {
    name: 'TemplateZen',
    // Preenchido a partir do arquivo VERSION (via js/version.js). O 'v0.0.0'
    // é apenas o fallback usado em desenvolvimento local, quando o build
    // ainda não gerou a versão real. Não edite o número à mão — altere o
    // arquivo VERSION.
    version: 'v' + (window.__APP_VERSION || '0.0.0'),
    // Preenchido com a data do build (via js/version.js). O valor abaixo é
    // apenas o fallback usado em desenvolvimento local, sem build.
    lastModified: window.__APP_BUILD_DATE || '27/08/2026',

    // Selo opcional ao lado do nome no cabeçalho (ex.: sigla da organização).
    // Deixe '' para ocultar.
    org: {
        sigla: '',
    },

    author: {
        nome: 'Alexsandro Cardoso Carvalho',
        github: 'https://github.com/alexsandroccarv',
    },
    repo: 'https://github.com/seu-usuario/seu-repo',
    license: {
        nome: 'GPLv3',
        url: 'https://www.gnu.org/licenses/gpl-3.0.html',
    },

    // Links exibidos no rodapé. Aponte para suas próprias páginas ou remova
    // o item correspondente em index.html.
    links: {
        termsOfUse: 'termodeuso.html',
        privacyPolicy: 'politicadeprivacidade.html',
        help: 'ajuda.html',
        about: 'sobre.html',
        coffee: 'doeumcafe.html',
        changelog: 'historico.html',
    },

    // Chaves de armazenamento local usadas pelo layout (tema, alto contraste,
    // escala de fonte). Prefixe conforme seu projeto para evitar colisões.
    storageKeys: {
        highContrast: 'altoContraste',
        fontScale: 'fontScale',
        userName: 'nome',
        themePreset: 'temaPreset',
    },
};
