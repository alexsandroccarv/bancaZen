/* ==========================================================================
   templateZen — Footer padrão (versão React do rodapé de src/index.html)
   --------------------------------------------------------------------------
   Porta o mesmo comportamento de src/js/layout.js (tema claro/escuro, alto
   contraste e escala de fonte) para hooks React, controlando as mesmas
   classes em <html> e as mesmas chaves de localStorage — então dá para
   trocar entre a versão HTML+JS puro e esta versão React sem quebrar as
   preferências já salvas do usuário.
   ========================================================================== */
import { useEffect, useState } from 'react';

const FS_MIN = 80, FS_MAX = 150, FS_STEP = 10;

/**
 * @param {Object} props
 * @param {string} props.version
 * @param {string} props.lastModified
 * @param {{ termsOfUse?: string, privacyPolicy?: string, help?: string, about?: string, coffee?: string, changelog?: string }} [props.links]
 * @param {{ nome?: string, github?: string }} [props.author]
 * @param {string} [props.repo]
 * @param {{ nome?: string, url?: string }} [props.license]
 * @param {{ highContrast: string, fontScale: string }} [props.storageKeys]
 */
export default function Footer({
    version,
    lastModified,
    links = {},
    author = {},
    repo,
    license = {},
    storageKeys = { highContrast: 'altoContraste', fontScale: 'fontScale' },
}) {
    // Inicializadores com guarda para SSR (Next.js): no servidor não há
    // `document`/`localStorage`, então caem no padrão; no cliente leem o
    // estado real já aplicado ao <html> (evitando "flash" ao montar).
    const [highContrast, setHighContrast] = useState(() =>
        typeof document !== 'undefined' && document.documentElement.classList.contains('high-contrast'));
    const [fontScale, setFontScale] = useState(() => {
        if (typeof window === 'undefined') return 100;
        try {
            const n = parseInt(localStorage.getItem(storageKeys.fontScale) || '100', 10);
            return isNaN(n) ? 100 : n;
        } catch (e) { return 100; }
    });

    useEffect(() => {
        document.documentElement.classList.toggle('high-contrast', highContrast);
        try { localStorage.setItem(storageKeys.highContrast, highContrast ? '1' : '0'); } catch (e) { /* storage indisponível */ }
    }, [highContrast, storageKeys.highContrast]);

    useEffect(() => {
        document.documentElement.style.fontSize = fontScale === 100 ? '' : `${fontScale}%`;
        try { localStorage.setItem(storageKeys.fontScale, String(fontScale)); } catch (e) { /* storage indisponível */ }
    }, [fontScale, storageKeys.fontScale]);

    const applyFontScale = (delta) => setFontScale((n) => Math.max(FS_MIN, Math.min(FS_MAX, n + delta)));

    return (
        <footer className="bg-brand-800 dark:bg-gray-950 border-t border-brand-700 dark:border-gray-700 py-3 px-6 text-xs text-blue-100 dark:text-gray-400 flex flex-col sm:flex-row justify-between items-center shrink-0 gap-4 transition-colors duration-300">
            <div className="flex items-center gap-4 flex-wrap justify-center">
                {links.termsOfUse && (
                    <>
                        <span className="text-white/25 dark:text-gray-700">|</span>
                        <a href={links.termsOfUse} className="hover:text-white transition-colors flex items-center gap-1" title="Termo de uso" aria-label="Termo de uso"><i aria-hidden="true" className="fa-solid fa-file-contract" /></a>
                    </>
                )}
                {links.privacyPolicy && (
                    <>
                        <span className="text-white/25 dark:text-gray-700">|</span>
                        <a href={links.privacyPolicy} className="hover:text-white transition-colors flex items-center gap-1" title="Política de privacidade" aria-label="Política de privacidade"><i aria-hidden="true" className="fa-solid fa-shield-halved" /></a>
                    </>
                )}
                {links.help && (
                    <>
                        <span className="text-white/25 dark:text-gray-700">|</span>
                        <a href={links.help} className="hover:text-white transition-colors flex items-center gap-1" title="Ajuda" aria-label="Ajuda"><i aria-hidden="true" className="fa-solid fa-circle-question" /></a>
                    </>
                )}
                {links.about && (
                    <>
                        <span className="text-white/25 dark:text-gray-700">|</span>
                        <a href={links.about} className="hover:text-white transition-colors flex items-center gap-1" title="Sobre" aria-label="Sobre"><i aria-hidden="true" className="fa-solid fa-circle-info" /></a>
                    </>
                )}

                <span className="text-white/25 dark:text-gray-700">|</span>
                <button
                    type="button"
                    className="hover:text-white transition-colors flex items-center gap-1"
                    aria-pressed={highContrast}
                    title="Alto contraste"
                    aria-label="Alto contraste"
                    onClick={() => setHighContrast((h) => !h)}
                >
                    <i aria-hidden="true" className="fa-solid fa-circle-half-stroke" />
                </button>

                <span className="text-white/25 dark:text-gray-700">|</span>
                <span className="flex items-center gap-1" role="group" aria-label="Tamanho da fonte">
                    <button
                        type="button"
                        className="hover:text-white transition-colors flex items-center gap-1"
                        title="Diminuir fonte"
                        aria-label="Diminuir fonte"
                        disabled={fontScale <= FS_MIN}
                        onClick={() => applyFontScale(-FS_STEP)}
                    >
                        <i aria-hidden="true" className="fa-solid fa-magnifying-glass-minus" /> A-
                    </button>
                    <button
                        type="button"
                        className="hover:text-white transition-colors flex items-center gap-1"
                        title="Aumentar fonte"
                        aria-label="Aumentar fonte"
                        disabled={fontScale >= FS_MAX}
                        onClick={() => applyFontScale(FS_STEP)}
                    >
                        <i aria-hidden="true" className="fa-solid fa-magnifying-glass-plus" /> A+
                    </button>
                </span>
            </div>

            <div className="flex gap-3 items-center flex-wrap justify-center">
                {author.github && (
                    <a href={author.github} target="_blank" rel="noopener" className="hover:text-white hover:underline transition-colors flex items-center gap-1">
                        <i aria-hidden="true" className="fa-brands fa-github text-white/90 dark:text-accent-400" /> {author.nome}
                    </a>
                )}
                {links.coffee && (
                    <>
                        <span className="text-white/40 dark:text-gray-600">|</span>
                        <a href={links.coffee} className="hover:text-white hover:underline transition-colors flex items-center gap-1" title="Doe um café"><i aria-hidden="true" className="fa-solid fa-mug-hot text-white/90 dark:text-accent-400" /> Doe um café</a>
                    </>
                )}
                {license.url && (
                    <>
                        <span className="text-white/40 dark:text-gray-600">|</span>
                        <a href={license.url} target="_blank" rel="noopener" className="hover:text-white transition-colors flex items-center gap-1" title={license.nome ? `Licença ${license.nome}` : undefined}>
                            <i aria-hidden="true" className="fa-solid fa-scale-balanced text-white/90 dark:text-accent-400" /> {license.nome}
                        </a>
                    </>
                )}

                <span className="text-white/40 dark:text-gray-600">|</span>
                <span className="flex items-center gap-1"><i aria-hidden="true" className="fa-solid fa-tag" title="Versão" /> {links.changelog ? <a href={links.changelog} className="font-mono hover:text-white hover:underline transition-colors" title="Notas de versão">{version}</a> : <span className="font-mono">{version}</span>}</span>
            </div>
        </footer>
    );
}
