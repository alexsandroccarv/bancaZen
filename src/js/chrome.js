/* ==========================================================================
   templateZen — cabeçalho e rodapé compartilhados (fonte única)
   --------------------------------------------------------------------------
   Injeta o cabeçalho e o rodapé nos pontos de montagem `#app-header` e
   `#app-footer`, para que as páginas de apoio (termo de uso, privacidade,
   ajuda, sobre, doe um café, histórico) repliquem o mesmo cabeçalho/rodapé
   do site SEM duplicar a marcação em cada arquivo.

   O `index.html` usa apenas `#app-footer` (mantém o próprio cabeçalho com as
   abas). Depois da injeção, o `layout.js` preenche os dados (APP_CONFIG) e
   liga os controles (tema, alto contraste, fonte) normalmente.

   Ordem de scripts esperada nas páginas:
     version.js -> config.js -> chrome.js -> layout.js
   ========================================================================== */
(function () {
    // Cabeçalho das páginas de apoio: barra da marca + link "Início".
    // (O index.html tem seu próprio cabeçalho com as abas de navegação.)
    function headerHTML() {
        return `
    <header class="bg-brand-600 dark:bg-gray-900 border-b border-brand-700 dark:border-gray-700 flex flex-col shadow-sm dark:shadow-lg z-20 shrink-0 transition-colors duration-300">
        <div class="flex items-center justify-between px-4 py-3 bg-brand-600 dark:bg-gray-900 transition-colors duration-300">
            <div class="flex items-center gap-3">
                <div class="w-8 h-8 rounded bg-white dark:bg-gradient-to-br dark:from-accent-600 dark:to-accent-900 flex items-center justify-center text-brand-600 dark:text-white font-bold transition-colors duration-300">
                    <i aria-hidden="true" class="fa-solid fa-star"></i>
                </div>
                <div class="flex items-center gap-2 overflow-hidden">
                    <span id="headerAppName" class="font-bold text-white leading-none whitespace-nowrap">TemplateZen</span>
                    <span class="text-xl text-white/30 dark:text-gray-700 font-light hidden">|</span>
                    <span id="headerSigla" class="font-bold text-white/90 dark:text-accent-400 leading-none whitespace-nowrap hidden"></span>
                    <span id="headerUserNameSep" class="text-xl text-white/30 dark:text-gray-700 font-light hidden">|</span>
                    <span id="headerUserName" class="font-bold text-white/90 dark:text-accent-400 leading-none whitespace-nowrap hidden"></span>
                </div>
            </div>
            <!-- Configurações: abre o painel na página inicial. -->
            <a href="index.html#config" title="Configurações" aria-label="Configurações" class="text-white/90 hover:text-white transition-colors w-8 h-8 flex items-center justify-center rounded shrink-0">
                <i aria-hidden="true" class="fa-solid fa-gear"></i>
            </a>
        </div>
        <nav class="bg-white dark:bg-gray-800 border-t border-brand-700/20 dark:border-gray-700 px-2" aria-label="Navegação">
            <div class="max-w-5xl mx-auto flex gap-1 overflow-x-auto">
                <a href="index.html" class="px-4 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-brand-600 dark:hover:text-accent-400 whitespace-nowrap flex items-center gap-1">
                    <i aria-hidden="true" class="fa-solid fa-arrow-left"></i> Início
                </a>
            </div>
        </nav>
    </header>`;
    }

    // Rodapé completo (idêntico em todo o site). Preenchido por layout.js.
    function footerHTML() {
        return `
    <footer class="bg-brand-800 dark:bg-gray-950 border-t border-brand-700 dark:border-gray-700 py-3 px-6 text-xs text-blue-100 dark:text-gray-400 flex flex-col sm:flex-row justify-between items-center shrink-0 gap-4 transition-colors duration-300">
        <div class="flex items-center gap-4 flex-wrap justify-center">
            <a id="footerTermsLink" href="termodeuso.html" class="hover:text-white transition-colors flex items-center gap-1" title="Termo de uso" aria-label="Termo de uso"><i aria-hidden="true" class="fa-solid fa-file-contract"></i></a>
            <span class="text-white/25 dark:text-gray-700">|</span>
            <a id="footerPrivacyLink" href="politicadeprivacidade.html" class="hover:text-white transition-colors flex items-center gap-1" title="Política de privacidade" aria-label="Política de privacidade"><i aria-hidden="true" class="fa-solid fa-shield-halved"></i></a>
            <span class="text-white/25 dark:text-gray-700">|</span>
            <a id="footerHelpLink" href="ajuda.html" class="hover:text-white transition-colors flex items-center gap-1" title="Ajuda" aria-label="Ajuda"><i aria-hidden="true" class="fa-solid fa-circle-question"></i></a>
            <span class="text-white/25 dark:text-gray-700">|</span>
            <a id="footerAboutLink" href="sobre.html" class="hover:text-white transition-colors flex items-center gap-1" title="Sobre" aria-label="Sobre"><i aria-hidden="true" class="fa-solid fa-circle-info"></i></a>
            <span class="text-white/25 dark:text-gray-700">|</span>
            <button type="button" id="highContrastToggle" class="hover:text-white transition-colors flex items-center gap-1" aria-pressed="false" title="Alto contraste" aria-label="Alto contraste">
                <i aria-hidden="true" class="fa-solid fa-circle-half-stroke"></i>
            </button>
            <span class="text-white/25 dark:text-gray-700">|</span>
            <span class="flex items-center gap-1" role="group" aria-label="Tamanho da fonte">
                <button type="button" id="fontDec" class="hover:text-white transition-colors flex items-center gap-1" title="Diminuir fonte" aria-label="Diminuir fonte"><i aria-hidden="true" class="fa-solid fa-magnifying-glass-minus"></i> A-</button>
                <button type="button" id="fontInc" class="hover:text-white transition-colors flex items-center gap-1" title="Aumentar fonte" aria-label="Aumentar fonte"><i aria-hidden="true" class="fa-solid fa-magnifying-glass-plus"></i> A+</button>
            </span>
        </div>
        <div class="flex gap-3 items-center flex-wrap justify-center">
            <a id="footerAuthorLink" href="https://github.com/alexsandroccarv" target="_blank" rel="noopener" class="hover:text-white hover:underline transition-colors flex items-center gap-1">
                <i aria-hidden="true" class="fa-brands fa-github text-white/90 dark:text-accent-400"></i> <span id="footerAuthorName">Alexsandro Cardoso Carvalho</span>
            </a>
            <span class="text-white/40 dark:text-gray-600">|</span>
            <a id="footerCoffeeLink" href="doeumcafe.html" class="hover:text-white hover:underline transition-colors flex items-center gap-1" title="Doe um café"><i aria-hidden="true" class="fa-solid fa-mug-hot text-white/90 dark:text-accent-400"></i> Doe um café</a>
            <span class="text-white/40 dark:text-gray-600">|</span>
            <a id="footerLicenseLink" href="https://www.gnu.org/licenses/gpl-3.0.html" target="_blank" rel="noopener" class="hover:text-white transition-colors flex items-center gap-1" title="Licença">
                <i aria-hidden="true" class="fa-solid fa-scale-balanced text-white/90 dark:text-accent-400"></i> <span id="footerLicenseName">GPLv3</span>
            </a>
            <span class="text-white/40 dark:text-gray-600">|</span>
            <span class="flex items-center gap-1"><i aria-hidden="true" class="fa-solid fa-tag" title="Versão"></i> <a id="footerHistoryLink" href="historico.html" class="font-mono hover:text-white hover:underline transition-colors" title="Notas de versão"><span id="appVersion"></span></a></span>
        </div>
    </footer>`;
    }

    function inject(id, html) {
        const el = document.getElementById(id);
        if (el && !el.innerHTML.trim()) el.innerHTML = html;
    }

    // Injeta o que existir na página (índice: só rodapé; apoio: ambos).
    inject('app-header', headerHTML());
    inject('app-footer', footerHTML());

    // Acessibilidade:
    // 1) Link "pular para o conteúdo" como primeiro foco da página.
    var main = document.querySelector('main');
    if (main) {
        if (!main.id) main.id = 'conteudo';
        main.setAttribute('tabindex', '-1');
        if (!document.querySelector('.skip-link')) {
            var sk = document.createElement('a');
            sk.href = '#' + main.id;
            sk.className = 'skip-link';
            sk.textContent = 'Pular para o conteúdo';
            document.body.insertBefore(sk, document.body.firstChild);
        }
    }
    // 2) Separadores "|" são decorativos: escondê-los dos leitores de tela.
    document.querySelectorAll('header span, nav span, footer span').forEach(function (s) {
        if (s.textContent.trim() === '|') s.setAttribute('aria-hidden', 'true');
    });

    window.Chrome = { headerHTML, footerHTML };
})();
