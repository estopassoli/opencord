// Pós-build: o SDK só usa TIPOS de @opencord/contracts (pacote privado do monorepo), então o JS gerado não depende
// dele, mas os .d.ts sim. Copiamos as declarações do contracts para dist/contracts/ e reescrevemos os imports (em
// qualquer profundidade de dist/), para o pacote publicado ser autossuficiente (só precisa de `zod`, que as
// declarações do contracts referenciam).
import { readdirSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname, relative, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, 'dist');
const contractsDist = join(root, '..', 'contracts', 'dist');
if (!existsSync(join(contractsDist, 'index.d.ts'))) {
  console.error('bundle-types: packages/contracts não está compilado (rode `pnpm --filter @opencord/contracts build`)');
  process.exit(1);
}

const out = join(dist, 'contracts');
mkdirSync(out, { recursive: true });
const copied = readdirSync(contractsDist).filter((f) => f.endsWith('.d.ts'));
for (const f of copied) copyFileSync(join(contractsDist, f), join(out, f));

/** todos os arquivos de dist/ (recursivo), exceto dist/contracts */
function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (p !== out) files.push(...walk(p));
    } else files.push(p);
  }
  return files;
}
const files = walk(dist);

let rewritten = 0;
for (const p of files.filter((f) => f.endsWith('.d.ts'))) {
  const src = readFileSync(p, 'utf8');
  // caminho relativo do arquivo até dist/contracts/index.js ('./contracts/index.js' na raiz, '../contracts/…' abaixo)
  let rel = posix.join(...relative(dirname(p), out).split(/[\\/]/), 'index.js');
  if (!rel.startsWith('.')) rel = `./${rel}`;
  // `from '@opencord/contracts'` e os `import("@opencord/contracts")` inline que o tsc emite em tipos inferidos
  const next = src.replace(/(['"])@opencord\/contracts\1/g, `'${rel}'`);
  if (next !== src) {
    writeFileSync(p, next);
    rewritten++;
  }
}

// o JS publicado não pode importar o pacote privado
for (const p of files.filter((f) => f.endsWith('.js'))) {
  if (/['"]@opencord\/contracts['"]/.test(readFileSync(p, 'utf8'))) {
    console.error(
      `bundle-types: ${relative(root, p)} importa @opencord/contracts em tempo de execução; o pacote não seria autossuficiente`,
    );
    process.exit(1);
  }
}
process.stdout.write(
  `bundle-types: ${copied.length} declarações do contracts copiadas, ${rewritten} arquivos reescritos\n`,
);
