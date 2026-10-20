/* ==========================================================================
   templateZen — setup do novo projeto
   --------------------------------------------------------------------------
   Substitui os placeholders do template de uma vez: nome do app, repositório,
   autor, licença e cor da marca.

   Uso interativo:  node scripts/setup.mjs
     (Enter mantém o valor atual mostrado entre colchetes.)

   Uso por flags (não interativo):
     node scripts/setup.mjs --name="Meu App" --repo=https://github.com/eu/app \
       --author="Fulano" --author-github=https://github.com/eu \
       --license=MIT --license-url=https://opensource.org/licenses/MIT \
       --brand=#e11d48
   ========================================================================== */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const p = (...s) => join(root, ...s);
const read = (f) => readFileSync(f, 'utf8');
const write = (f, c) => writeFileSync(f, c);

// ---- Cor: gera uma escala Tailwind a partir de um hex base ----
function clamp(n) { return Math.max(0, Math.min(255, Math.round(n))); }
function parseHex(hex) {
    hex = hex.replace('#', '').trim();
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
}
function toHex(rgb) { return '#' + rgb.map((n) => clamp(n).toString(16).padStart(2, '0')).join(''); }
function mix(base, target, amt) { return base.map((c, i) => c + (target[i] - c) * amt); }
function scale(hex) {
    const b = parseHex(hex), W = [255, 255, 255], K = [0, 0, 0];
    return {
        50: toHex(mix(b, W, 0.90)), 100: toHex(mix(b, W, 0.80)), 400: toHex(mix(b, W, 0.35)),
        600: toHex(b), 700: toHex(mix(b, K, 0.15)), 800: toHex(mix(b, K, 0.30)), 900: toHex(mix(b, K, 0.45)),
    };
}
const isHex = (s) => /^#?[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(String(s).trim());

// ---- Flags ----
const flags = {};
for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (m) flags[m[1]] = m[2];
}

// ---- Valores atuais (padrões) ----
const configPath = p('src/js/config.js');
let config = read(configPath);
const cur = (re, fb) => (config.match(re)?.[1] ?? fb);
const defaults = {
    name: cur(/name:\s*'([^']*)'/, 'TemplateZen'),
    repo: cur(/repo:\s*'([^']*)'/, ''),
    author: cur(/nome:\s*'([^']*)'/, ''),
    'author-github': cur(/github:\s*'([^']*)'/, ''),
    license: cur(/license:\s*\{[^}]*nome:\s*'([^']*)'/, ''),
    'license-url': cur(/license:\s*\{[^}]*url:\s*'([^']*)'/, ''),
    brand: '#1d4ed8',
};

const interactive = input.isTTY && Object.keys(flags).length === 0;
let answers = { ...defaults, ...flags };

if (interactive) {
    const rl = createInterface({ input, output });
    const ask = async (key, label) => { const a = (await rl.question(`${label} [${defaults[key]}]: `)).trim(); return a || defaults[key]; };
    console.log('\n== Setup do templateZen — Enter mantém o valor atual ==\n');
    answers.name = await ask('name', 'Nome do app');
    answers.repo = await ask('repo', 'URL do repositório');
    answers.author = await ask('author', 'Autor (nome)');
    answers['author-github'] = await ask('author-github', 'GitHub do autor');
    answers.license = await ask('license', 'Licença (nome)');
    answers['license-url'] = await ask('license-url', 'Licença (URL)');
    answers.brand = await ask('brand', 'Cor da marca (hex)');
    await rl.close();
}

if (!isHex(answers.brand)) { console.error(`Cor da marca inválida: ${answers.brand}`); process.exit(1); }
if (!answers.brand.startsWith('#')) answers.brand = '#' + answers.brand;

// ---- 1) config.js (fonte de verdade em runtime) ----
config = config
    .replace(/(name:\s*')[^']*(')/, `$1${answers.name}$2`)
    .replace(/(repo:\s*')[^']*(')/, `$1${answers.repo}$2`)
    .replace(/(nome:\s*')[^']*(')/, `$1${answers.author}$2`)
    .replace(/(github:\s*')[^']*(')/, `$1${answers['author-github']}$2`)
    .replace(/(license:\s*\{[^}]*?nome:\s*')[^']*(')/, `$1${answers.license}$2`)
    .replace(/(license:\s*\{[^}]*?url:\s*')[^']*(')/, `$1${answers['license-url']}$2`);
write(configPath, config);

// ---- 2) cdn.js: escala da cor da marca ----
const cdnPath = p('src/js/cdn.js');
const s = scale(answers.brand);
const brandLine = `brand:  { 50: '${s[50]}', 100: '${s[100]}', 400: '${s[400]}', 600: '${s[600]}', 700: '${s[700]}', 800: '${s[800]}', 900: '${s[900]}' },`;
write(cdnPath, read(cdnPath).replace(/brand:\s*\{[^}]*\},/, brandLine));

// ---- 3) Nome exibido em HTML (título, Open Graph, fallback do cabeçalho) ----
write(p('src/index.html'), read(p('src/index.html'))
    .replace(/<title>[^<]*<\/title>/, `<title>${answers.name}</title>`)
    .replace(/content="templateZen"/g, `content="${answers.name}"`)
    .replace(/(id="headerAppName"[^>]*>)[^<]*(<)/, `$1${answers.name}$2`));
write(p('src/js/chrome.js'), read(p('src/js/chrome.js'))
    .replace(/(id="headerAppName"[^>]*>)[^<]*(<)/, `$1${answers.name}$2`));

// ---- 4) URL do repositório em config das issues (Discussions) ----
const issueCfg = p('.github/ISSUE_TEMPLATE/config.yml');
if (existsSync(issueCfg) && answers.repo) {
    write(issueCfg, read(issueCfg).replace(/url:\s*https?:\/\/\S+/, `url: ${answers.repo.replace(/\/$/, '')}/discussions`));
}

console.log('\nOK! Placeholders atualizados.');
console.log(`  Nome: ${answers.name} | Marca: ${answers.brand}`);
console.log('\nAinda falta (manual):');
console.log('  1. Trocar src/logo.svg pela sua marca (é o favicon).');
console.log('  2. Definir a variável SITE_URL (GitHub Actions) para SEO/sitemap.');
console.log('  3. Editar o conteúdo das páginas de apoio em src/.');
console.log('  4. Revisar CLAUDE.md, README.md e CHANGELOG.md.');
console.log('\nValide com: node build.mjs\n');
