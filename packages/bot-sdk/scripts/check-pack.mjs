// `prepack`: garante que o tarball leva as declarações embutidas e que nada em dist/ referencia o pacote privado.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, 'dist');
const contracts = join(dist, 'contracts');
const fail = (msg) => {
  console.error(`check-pack: ${msg}`);
  process.exit(1);
};
if (!existsSync(join(dist, 'index.js'))) fail('dist/ vazio; rode `pnpm build` antes de empacotar');
if (!existsSync(join(contracts, 'index.d.ts'))) fail('dist/contracts/ ausente; o build não rodou bundle-types');
function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (p !== contracts) files.push(...walk(p));
    } else files.push(p);
  }
  return files;
}
for (const p of walk(dist)) {
  if (!p.endsWith('.d.ts') && !p.endsWith('.js')) continue;
  // só importações contam (comentários podem citar o nome do pacote)
  if (/['"]@opencord\/contracts['"]/.test(readFileSync(p, 'utf8')))
    fail(`${relative(root, p)} ainda importa @opencord/contracts`);
}
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
if (pkg.dependencies?.['@opencord/contracts']) fail('@opencord/contracts não pode ser dependência publicada');
if (pkg.license !== 'MIT') fail('o SDK é publicado sob MIT (ADR-0032)');
process.stdout.write('check-pack: ok\n');
