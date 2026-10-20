/* ==========================================================================
   templateZen — Header padrão (versão React do cabeçalho de src/index.html)
   --------------------------------------------------------------------------
   Assume Tailwind configurado com as cores `brand`/`accent` (ver o
   TW_CONFIG comentado em src/index.html) e Font Awesome disponível.
   ========================================================================== */

/**
 * @param {Object} props
 * @param {string} props.appName - Nome do app exibido ao lado do logo.
 * @param {string} [props.sigla] - Selo opcional (ex.: sigla da organização). Omita para ocultar.
 * @param {string} [props.userName] - Nome definido pelo usuário, exibido como "| nome" após o app. Omita para ocultar.
 * @param {{ key: string, label: string, icon?: string }[]} props.tabs - Abas de navegação.
 * @param {string} props.activeTab - `key` da aba ativa.
 * @param {(key: string) => void} props.onTabChange - Chamado ao clicar em uma aba.
 * @param {() => void} [props.onConfigClick] - Se fornecido, mostra uma engrenagem à direita da linha superior (ex.: abrir Configurações).
 */
export default function Header({ appName, sigla = '', userName = '', tabs, activeTab, onTabChange, onConfigClick }) {
    return (
        <header className="bg-brand-600 dark:bg-gray-900 border-b border-brand-700 dark:border-gray-700 flex flex-col shadow-sm dark:shadow-lg z-20 shrink-0 transition-colors duration-300">
            <div className="flex items-center justify-between px-4 py-3 bg-brand-600 dark:bg-gray-900 transition-colors duration-300">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded bg-white dark:bg-gradient-to-br dark:from-accent-600 dark:to-accent-900 flex items-center justify-center text-brand-600 dark:text-white font-bold transition-colors duration-300">
                        <i aria-hidden="true" className="fa-solid fa-star" />
                    </div>
                    <div className="flex items-center gap-2 overflow-hidden">
                        <h1 className="font-bold text-white leading-none whitespace-nowrap">{appName}</h1>
                        {sigla && (
                            <>
                                <span className="text-xl text-white/30 dark:text-gray-700 font-light">|</span>
                                <span className="font-bold text-white/90 dark:text-accent-400 leading-none whitespace-nowrap">{sigla}</span>
                            </>
                        )}
                        {userName && (
                            <>
                                <span className="text-xl text-white/30 dark:text-gray-700 font-light">|</span>
                                <span className="font-bold text-white/90 dark:text-accent-400 leading-none whitespace-nowrap">{userName}</span>
                            </>
                        )}
                    </div>
                </div>
                {onConfigClick && (
                    <button
                        type="button"
                        onClick={onConfigClick}
                        title="Configurações"
                        aria-label="Configurações"
                        className="text-white/90 hover:text-white transition-colors w-8 h-8 flex items-center justify-center rounded shrink-0"
                    >
                        <i aria-hidden="true" className="fa-solid fa-gear" />
                    </button>
                )}
            </div>

            <nav className="bg-white dark:bg-gray-800 border-t border-brand-700/20 dark:border-gray-700 px-2" role="tablist" aria-label="Seções">
                <div className="max-w-5xl mx-auto flex gap-1 overflow-x-auto">
                    {tabs.map((tab) => (
                        <button
                            key={tab.key}
                            type="button"
                            className="tab-btn px-4 py-2.5 text-sm font-medium border-b-2 border-transparent text-gray-600 dark:text-gray-300 hover:text-brand-600 dark:hover:text-accent-400 whitespace-nowrap"
                            role="tab"
                            aria-selected={activeTab === tab.key}
                            onClick={() => onTabChange(tab.key)}
                        >
                            {tab.icon && <i aria-hidden="true" className={`${tab.icon} mr-1`} />}
                            {tab.label}
                        </button>
                    ))}
                </div>
            </nav>
        </header>
    );
}
