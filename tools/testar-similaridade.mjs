/* ==========================================================================
   BuscaBanca — teste do extrator Lattes e da proximidade temática
   --------------------------------------------------------------------------
   Processa os currículos fictícios de tools/fixtures/ (XML e ZIP) e confere:
   extração dos campos, faixa da proximidade (0 a 1), ordenação, limite de
   resultados, filtros e a verificação de vínculos (coautoria, orientação e
   mesma pessoa) com a aluna e a orientadora de tools/fixtures/envolvidos/.
   Uso: node tools/testar-similaridade.mjs
   ========================================================================== */
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const LattesCorpus = require('../src/js/lattes-corpus.js');
const Similaridade = require('../src/js/similaridade.js');
const Vinculos = require('../src/js/vinculos.js');

const dir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const pessoas = [];
for (const f of readdirSync(dir).filter((f) => /\.(xml|zip)$/.test(f)).sort()) {
    pessoas.push(...await LattesCorpus.lerArquivo(f, readFileSync(join(dir, f))));
}

// Extração
assert.equal(pessoas.length, 5, 'cinco currículos (quatro XML e um ZIP)');
const ana = pessoas.find((p) => p.id === '0000000000000001');
assert.equal(ana.nome, 'Ana Fictícia Souza', 'nome com acento (ISO-8859-1)');
assert.equal(ana.titulacao, 'Doutorado');
assert.equal(ana.instituicao, 'Universidade Federal Exemplo');
assert.equal(ana.bancasMestrado, 3);
assert.equal(ana.producoes.length, 3);
assert.ok(ana.resumo.startsWith('Professora') && !ana.resumo.includes('<'), 'resumo sem HTML');
assert.ok(ana.palavrasChave.includes('Accountability'));
assert.ok(!JSON.stringify(ana).includes('nao@extrair.br'), 'e-mail não é extraído');
assert.equal(pessoas.find((p) => p.id === '0000000000000005').nome, 'Elisa Zipada Teste', 'leitura de ZIP');

// Proximidade
const indice = Similaridade.criarIndice(pessoas, 2026);
const consulta = {
    titulo: 'Transparência e controle social na governança dos municípios',
    resumo: 'Analisa a transparência ativa dos portais de prefeituras e o papel do controle social na accountability local.',
    palavrasChave: ['governança pública', 'transparência', 'accountability'],
};
const { resultados } = Similaridade.buscar(indice, consulta, { limite: 10 });
for (const r of resultados) assert.ok(r.score >= 0 && r.score <= 1, 'proximidade entre 0 e 1');
for (let i = 1; i < resultados.length; i++) assert.ok(resultados[i - 1].score >= resultados[i].score, 'ordem decrescente');
assert.ok(['0000000000000001', '0000000000000005'].includes(resultados[0].pessoa.id), 'perfil de governança em primeiro');
const bruno = resultados.find((r) => r.pessoa.id === '0000000000000002');
assert.ok(!bruno || bruno.score < resultados[0].score / 3, 'logística fica bem abaixo');

assert.equal(Similaridade.buscar(indice, consulta, { limite: 2 }).resultados.length, 2, 'limite');
const semInst = Similaridade.buscar(indice, consulta, { excluirInstituicao: 'federal exemplo' }).resultados;
assert.ok(semInst.every((r) => !/Federal Exemplo/.test(r.pessoa.instituicao)), 'exclui a instituição do programa');
const doutores = Similaridade.buscar(indice, consulta, { somenteDoutores: true }).resultados;
assert.ok(doutores.every((r) => r.pessoa.nivel >= 5), 'somente doutores');

// Vínculos
const ler = async (f) => (await LattesCorpus.lerArquivo(f, readFileSync(join(dir, 'envolvidos', f))))[0];
const aluna = await ler('aluna.xml');
const orientadora = await ler('orientadora.xml');
assert.deepEqual(orientadora.citacoes, ['PRADO, O. O.', 'Prado, Olga Orientadora']);
assert.equal(orientadora.producoes[0].au.length, 2, 'autores da produção');
assert.equal(orientadora.orientacoes[0].o, 'Maria Discente Rocha', 'orientando da orientação em andamento');
assert.equal(aluna.orientadores[0].n, 'Diego Suposto Alves', 'orientador da graduação');

const envolvidos = [{ papel: 'Aluna', pessoa: aluna }, { papel: 'Orientadora', pessoa: orientadora }];
const porId = (id) => pessoas.find((p) => p.id === id);
const tipos = (v) => v.map((x) => `${x.papel}:${x.tipo}:${x.certeza}`).sort();

assert.deepEqual(tipos(Vinculos.verificar(porId('0000000000000001'), envolvidos)), ['Orientadora:coautoria:confirmado'], 'coautoria pelo ID Lattes');
assert.deepEqual(tipos(Vinculos.verificar(porId('0000000000000005'), envolvidos)), [], 'ID diferente: sem vínculo, mesmo com nome parecido');
assert.deepEqual(tipos(Vinculos.verificar(porId('0000000000000003'), envolvidos)), ['Orientadora:coautoria:provável'], 'coautoria pelo nome em citação');
assert.deepEqual(tipos(Vinculos.verificar(porId('0000000000000004'), envolvidos)), ['Aluna:orientação:confirmado'], 'orientação na graduação');
assert.deepEqual(tipos(Vinculos.verificar(porId('0000000000000002'), envolvidos)), ['Orientadora:coautoria:confirmado'], 'coautoria pelo nome completo');
assert.deepEqual(tipos(Vinculos.verificar(porId('0000000000000002'), envolvidos, { desdeAno: 2021 })), [], 'coautoria antiga fora do período');
assert.deepEqual(tipos(Vinculos.verificar(orientadora, envolvidos)), ['Aluna:orientação:confirmado', 'Orientadora:mesma pessoa:confirmado'], 'a própria orientadora');
assert.ok(!Vinculos.chavesCombinam(Vinculos.chave('SILVA, J.'), Vinculos.chave('João Pedro Silva')), 'uma inicial só não basta');
assert.ok(Vinculos.chavesCombinam(Vinculos.chave('SILVA, J. P.'), Vinculos.chave('João Pedro da Silva Junior')), 'partículas e sufixos');

console.log('Ranking da consulta de teste:');
for (const r of resultados) console.log(`  ${r.score.toFixed(3)}  ${r.pessoa.nome}  [${r.termos.join(', ')}]`);
console.log('OK: extrator, proximidade e vínculos conferidos.');
