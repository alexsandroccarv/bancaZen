/* ==========================================================================
   templateZen — auditoria de contraste (WCAG) das paletas de tema
   --------------------------------------------------------------------------
   Lê as paletas (html[data-tz-theme="..."]) de src/css/styles.css e verifica
   os pares de cor críticos contra os limiares WCAG AA. Sai com código 1 se
   algum par reprovar — útil como portão de qualidade ao adicionar temas.

   Uso:  node tools/contrast-check.mjs
   ========================================================================== */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(root, 'src/css/styles.css'), 'utf8');

// Coleta as variáveis --tz-* de cada bloco html[data-tz-theme="X"]{...}.
const themes = {};
const re = /html\[data-tz-theme="([a-z-]+)"\]\{([^}]+)\}/g;
let m;
while ((m = re.exec(css))) {
    const name = m[1];
    themes[name] = themes[name] || {};
    for (const decl of m[2].split(';')) {
        const i = decl.indexOf(':');
        if (i > 0) themes[name][decl.slice(0, i).trim()] = decl.slice(i + 1).trim();
    }
}

function luminance(hex) {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    const ch = [0, 2, 4]
        .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
function ratio(a, b) {
    const l1 = luminance(a), l2 = luminance(b);
    const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
    return (hi + 0.05) / (lo + 0.05);
}

// [rótulo, primeiro plano, fundo, limiar]. Cabeçalho é texto grande/negrito (3:1).
const PAIRS = [
    ['texto/fundo', '--tz-text', '--tz-bg', 4.5],
    ['cabeçalho (grande)', '--tz-header-text', '--tz-header', 3.0],
    ['aba/nav', '--tz-nav-text', '--tz-nav', 4.5],
    ['aba ativa/nav', '--tz-accent', '--tz-nav', 4.5],
    ['rodapé texto/bg', '--tz-footer-text', '--tz-footer', 4.5],
    ['texto/superfície', '--tz-text', '--tz-surface', 4.5],
    ['muted/fundo', '--tz-muted', '--tz-bg', 4.0],
    ['muted/superfície', '--tz-muted', '--tz-surface', 4.0],
];

let failed = 0;
const names = Object.keys(themes);
for (const name of names) {
    const v = themes[name];
    const problems = [];
    for (const [label, fg, bg, th] of PAIRS) {
        if (!v[fg] || !v[bg]) continue;
        const r = ratio(v[fg], v[bg]);
        if (r < th) problems.push(`${label}=${r.toFixed(2)}<${th} (${v[fg]}/${v[bg]})`);
    }
    if (problems.length) {
        failed++;
        console.error(`FAIL ${name}\n   - ${problems.join('\n   - ')}`);
    } else {
        console.log(`ok   ${name}`);
    }
}

console.log(`\n${names.length} temas verificados, ${failed} com problema(s).`);
process.exit(failed ? 1 : 0);
