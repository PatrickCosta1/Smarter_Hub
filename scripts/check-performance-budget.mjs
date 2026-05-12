import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const distAssetsDir = path.resolve(process.cwd(), 'dist', 'assets');

const MAX_ENTRY_JS_KB = Number(process.env.BUDGET_ENTRY_JS_KB ?? 230);
const MAX_ENTRY_CSS_KB = Number(process.env.BUDGET_ENTRY_CSS_KB ?? 320);
const MAX_CHUNK_KB = Number(process.env.BUDGET_MAX_CHUNK_KB ?? 980);
const MAX_TOTAL_JS_KB = Number(process.env.BUDGET_TOTAL_JS_KB ?? 2200);

function toKb(bytes) {
  return Math.round((bytes / 1024) * 100) / 100;
}

function fail(message) {
  console.error(`PERF_BUDGET_FAIL: ${message}`);
  process.exit(1);
}

const entries = await readdir(distAssetsDir, { withFileTypes: true });
const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);

const jsFiles = files.filter((name) => name.endsWith('.js'));
const cssFiles = files.filter((name) => name.endsWith('.css'));

const entryJsFile = jsFiles.find((name) => /^index-.*\.js$/i.test(name));
const entryCssFile = cssFiles.find((name) => /^index-.*\.css$/i.test(name));

if (!entryJsFile) {
  fail('Não foi encontrado chunk principal de JS (index-*.js).');
}

if (!entryCssFile) {
  fail('Não foi encontrado chunk principal de CSS (index-*.css).');
}

const entryJsStats = await stat(path.join(distAssetsDir, entryJsFile));
const entryCssStats = await stat(path.join(distAssetsDir, entryCssFile));

const entryJsKb = toKb(entryJsStats.size);
const entryCssKb = toKb(entryCssStats.size);

if (entryJsKb > MAX_ENTRY_JS_KB) {
  fail(`Entry JS ${entryJsFile} com ${entryJsKb}KB > limite ${MAX_ENTRY_JS_KB}KB.`);
}

if (entryCssKb > MAX_ENTRY_CSS_KB) {
  fail(`Entry CSS ${entryCssFile} com ${entryCssKb}KB > limite ${MAX_ENTRY_CSS_KB}KB.`);
}

let totalJsBytes = 0;
for (const jsFile of jsFiles) {
  const fileStats = await stat(path.join(distAssetsDir, jsFile));
  totalJsBytes += fileStats.size;

  const fileKb = toKb(fileStats.size);
  if (fileKb > MAX_CHUNK_KB) {
    fail(`Chunk ${jsFile} com ${fileKb}KB > limite ${MAX_CHUNK_KB}KB.`);
  }
}

const totalJsKb = toKb(totalJsBytes);
if (totalJsKb > MAX_TOTAL_JS_KB) {
  fail(`Soma de JS (${totalJsKb}KB) > limite ${MAX_TOTAL_JS_KB}KB.`);
}

console.log('PERF_BUDGET_OK', {
  entryJsFile,
  entryJsKb,
  entryCssFile,
  entryCssKb,
  totalJsKb,
  chunkCount: jsFiles.length,
});
