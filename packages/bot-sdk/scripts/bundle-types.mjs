// Pós-build: o SDK só usa TIPOS de @opencord/contracts (pacote privado do monorepo), então o JS gerado não depende
// dele, mas os .d.ts sim. Copiamos as declarações do contracts para dist/contracts/ e reescrevemos os imports, para o
// pacote publicado ser autossuficiente (só precisa de `zod`, que as declarações do contracts referenciam).
import { readdirSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
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

let rewritten = 0;
for (const f of readdirSync(dist).filter((f) => f.endsWith('.d.ts'))) {
  const p = join(dist, f);
  const src = readFileSync(p, 'utf8');
  const next = src.replace(/from '@opencord\/contracts'/g, "from './contracts/index.js'");
  if (next !== src) {
    writeFileSync(p, next);
    rewritten++;
  }
}

// o JS publicado não pode importar o pacote privado
for (const f of readdirSync(dist).filter((f) => f.endsWith('.js'))) {
  if (readFileSync(join(dist, f), 'utf8').includes('@opencord/contracts')) {
    console.error(
      `bundle-types: dist/${f} importa @opencord/contracts em tempo de execução; o pacote não seria autossuficiente`,
    );
    process.exit(1);
  }
}
process.stdout.write(
  `bundle-types: ${copied.length} declarações do contracts copiadas, ${rewritten} arquivos reescritos\n`,
);
