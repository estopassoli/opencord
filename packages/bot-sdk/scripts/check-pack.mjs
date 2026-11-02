// `prepack`: garante que o tarball leva as declarações embutidas e que nada em dist/ referencia o pacote privado.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, 'dist');
const fail = (msg) => {
  console.error(`check-pack: ${msg}`);
  process.exit(1);
};
if (!existsSync(join(dist, 'index.js'))) fail('dist/ vazio; rode `pnpm build` antes de empacotar');
if (!existsSync(join(dist, 'contracts', 'index.d.ts'))) fail('dist/contracts/ ausente; o build não rodou bundle-types');
for (const f of readdirSync(dist)) {
  if (!f.endsWith('.d.ts') && !f.endsWith('.js')) continue;
  if (readFileSync(join(dist, f), 'utf8').includes('@opencord/contracts'))
    fail(`dist/${f} ainda referencia @opencord/contracts`);
}
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
if (pkg.dependencies?.['@opencord/contracts']) fail('@opencord/contracts não pode ser dependência publicada');
if (pkg.license !== 'MIT') fail('o SDK é publicado sob MIT (ADR-0032)');
process.stdout.write('check-pack: ok\n');
