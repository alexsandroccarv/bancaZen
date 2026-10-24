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

// Tons derivados do visual "etapas em cartões" (--bz-*, issue #83): lidos
// do bloco html.tz-theme e das sobreposições por tema; color-mix(in srgb, ...)
// é calculado aqui com as cores de cada paleta.
const derivados = {};
// Junta todos os blocos "<seletor> {" (o mesmo seletor aparece mais de uma vez).
const bloco = (sel) => {
    let out = '', i = -1;
    while ((i = css.indexOf(sel + ' {', i + 1)) >= 0) out += css.slice(i, css.indexOf('}', i));
    return out;
};
const lerBz = (txt, alvo) => { for (const d of txt.matchAll(/(--bz-[a-z0-9-]+):\s*([^;]+);/g)) alvo[d[1]] = d[2].trim(); };
lerBz(bloco('html.tz-theme'), derivados);
const hexRgb = (h) => { h = h.replace('#', ''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
const rgbHex = (c) => '#' + c.map((x) => Math.round(x).toString(16).padStart(2, '0')).join('');
function avaliar(expr, v, bz) {
    expr = expr.trim();
    const mv = expr.match(/^var\((--[a-z0-9-]+)\)$/);
    if (mv) return mv[1].startsWith('--bz-') ? avaliar(bz[mv[1]], v, bz) : v[mv[1]];
    if (expr.startsWith('#')) return expr;
    const mm = expr.match(/^color-mix\(in srgb,\s*(.+?)\s+(\d+)%,\s*(.+)\)$/);
    if (mm) {
        const a = hexRgb(avaliar(mm[1], v, bz)), b = hexRgb(avaliar(mm[3], v, bz)), p = Number(mm[2]) / 100;
        return rgbHex(a.map((x, i) => x * p + b[i] * (1 - p)));
    }
    return null;
}
// [rótulo, primeiro plano, fundo, limiar]; "pagina" = fundo da página.
const PARES_BZ = [
    ['bz-muted/superfície', '--bz-muted', '--tz-surface', 4.5],
    ['bz-muted/página', '--bz-muted', 'pagina', 4.5],
    ['bz-muted/campo', '--bz-muted', '--bz-campo', 4.5],
    ['bz-muted/quadro', '--bz-muted', '--bz-dica', 4.5],
    ['acento-texto/superfície', '--bz-acento-texto', '--tz-surface', 4.5],
    ['acento-texto/página', '--bz-acento-texto', 'pagina', 4.5],
    ['acento-texto/área de arquivo', '--bz-acento-texto', '--bz-suave-leve', 4.5],
    ['texto/tinta', '--bz-texto-tinta', '--bz-suave', 4.5],
    ['texto/quadro', '--bz-texto-tinta', '--bz-dica', 4.5],
    ['texto/quadro verde', '--bz-texto-tinta', '--bz-suave-2', 4.5],
    ['botão (texto/destaque)', '--bz-sobre-acento', '--tz-accent', 4.5],
    ['ícone/tinta', '--tz-accent', '--bz-suave', 3.0],
    ['marca concluída', '--bz-sobre-acento', '--bz-verde', 3.0],
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
    if (v['--tz-accent'] && v['--tz-accent-2']) {
        const bz = { ...derivados };
        lerBz(bloco(`html[data-tz-theme="${name}"]`), bz);
        const cor = (k) => (k === 'pagina' ? avaliar('color-mix(in srgb, var(--tz-accent) 4%, var(--tz-bg))', v, bz) : avaliar(`var(${k})`, v, bz));
        for (const [label, fg, bg, th] of PARES_BZ) {
            const a = cor(fg), b = cor(bg);
            if (!a || !b) { problems.push(`${label}: não foi possível calcular`); continue; }
            const r = ratio(a, b);
            if (r < th) problems.push(`${label}=${r.toFixed(2)}<${th} (${a}/${b})`);
        }
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
