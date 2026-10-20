/* ==========================================================================
   templateZen — build (monta a pasta publicável)
   --------------------------------------------------------------------------
   A aplicação é composta por vários arquivos (index.html + css/ + js/ +
   imagens) dentro de src/. Este build apenas MONTA a pasta dist/ (o que vai
   para o servidor) copiando fielmente os arquivos de src/ — sem
   embutir/inlinar nada — mais eventuais assets e páginas de apoio da raiz
   do repositório (ex.: termodeuso.html, favicon.ico).

   Uso:  node build.mjs
   ========================================================================== */
import { cpSync, rmSync, mkdirSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const src = join(root, 'src');
const dist = join(root, 'dist');

// 1) Recria dist/ do zero
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

// 2) Copia TODO o conteúdo de src/ (index.html, css/, js/, images/…) para dist/,
// exceto components/ — os .jsx de src/components/ são a versão React do
// cabeçalho/rodapé (para projetos com bundler próprio) e não fazem parte
// do site estático publicado por este build.
cpSync(src, dist, {
    recursive: true,
    filter: (path) => path !== join(src, 'components') && !path.startsWith(join(src, 'components') + '/'),
});

// 2.1) Injeta a versão (arquivo VERSION) e a data do build em
// dist/js/version.js, para que o rodapé (config.js -> #appVersion /
// #lastModDate) reflita automaticamente, sem edição manual. Em src/ o arquivo
// fica com placeholders (null); aqui ele é sobrescrito só no que é publicado.
const versionFile = join(root, 'VERSION');
const versionOut = join(dist, 'js', 'version.js');
if (existsSync(versionOut)) {
    const version = existsSync(versionFile) ? readFileSync(versionFile, 'utf8').trim() : null;
    // Data do build em UTC (determinística na CI), formato DD/MM/AAAA.
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const buildDate = `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
    writeFileSync(
        versionOut,
        `/* Gerado por build.mjs (VERSION + data do build) — não editar. */\n` +
        `window.__APP_VERSION = ${JSON.stringify(version)};\n` +
        `window.__APP_BUILD_DATE = ${JSON.stringify(buildDate)};\n`
    );
    console.log(`Injetado em dist/js/version.js: versão ${version}, build ${buildDate}`);
}

// 3) Copia assets opcionais que vivam na raiz do repositório. As páginas de
// apoio (termo de uso, privacidade, ajuda, sobre, doe um café, histórico)
// ficam em src/ e já são copiadas no passo 2. Ajuste esta lista conforme os
// assets extras do seu projeto.
for (const name of ['images', 'favicon.ico']) {
    const p = join(root, name);
    if (existsSync(p)) cpSync(p, join(dist, name), { recursive: true });
}

// 4) URL do site: substitui o placeholder %SITE_URL% (metatags Open Graph,
// canonical, robots) pela URL real e gera o sitemap.xml. A URL vem da
// variável de ambiente SITE_URL (ex.: repo variable na CI); sem ela, usa um
// placeholder e avisa.
const SITE_URL = (process.env.SITE_URL || 'https://seu-dominio.exemplo').replace(/\/+$/, '');
if (!process.env.SITE_URL) {
    console.warn('AVISO: SITE_URL não definida — usando placeholder "' + SITE_URL +
        '". Defina SITE_URL (env/variável) para URLs absolutas corretas.');
}

// 4.1) Substitui %SITE_URL% em todos os .html e no robots.txt do dist/.
function listFiles(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = join(dir, e.name);
        return e.isDirectory() ? listFiles(p) : [p];
    });
}
for (const file of listFiles(dist)) {
    if (/\.(html|txt)$/.test(file)) {
        const content = readFileSync(file, 'utf8');
        if (content.includes('%SITE_URL%')) {
            writeFileSync(file, content.split('%SITE_URL%').join(SITE_URL));
        }
    }
}

// 4.2) Gera dist/sitemap.xml com as páginas públicas (exclui 404).
const today = new Date().toISOString().slice(0, 10); // AAAA-MM-DD
const pages = readdirSync(dist)
    .filter((f) => f.endsWith('.html') && f !== '404.html')
    .sort((a, b) => (a === 'index.html' ? -1 : b === 'index.html' ? 1 : a.localeCompare(b)));
const urls = pages.map((f) => {
    const loc = f === 'index.html' ? SITE_URL + '/' : `${SITE_URL}/${f}`;
    const priority = f === 'index.html' ? '1.0' : '0.6';
    return `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${today}</lastmod>\n    <priority>${priority}</priority>\n  </url>`;
}).join('\n');
writeFileSync(
    join(dist, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
);
console.log(`sitemap.xml gerado (${pages.length} páginas) para ${SITE_URL}`);

console.log('OK: dist/ montado.');
console.log('Conteúdo de dist/: ' + readdirSync(dist).join('  '));
