// Carimba em cada novidade do changelog a versão do app em que ela entrou (campo `version`), olhando as tags de
// release (v0.2.<n>): a versão é a da primeira tag cujo changelog já tinha a entrada (mesma data, hora e título).
//
// Uso (da raiz do repositório, com as tags baixadas):
//   node apps/desktop/scripts/changelog-versions.mjs [--current <versão>]
//     Só olha as tags depois da maior versão já carimbada. Com --current, o que ainda não está em nenhuma tag
//     recebe essa versão (o CI passa a versão que está construindo, antes do build).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { entriesAt } from './release-notes.mjs';

const CHANGELOG = 'apps/desktop/src/features/home/changelog.ts';
const args = process.argv.slice(2);
const current = args.includes('--current') ? args[args.indexOf('--current') + 1] : undefined;
const repo = process.cwd();

const parse = (v) => v.split('.').map(Number);
const cmp = (a, b) => {
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++)
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
};
const key = (e) => `${e.date}|${e.time ?? ''}|${e.title}`;

const entries = await entriesAt();
const pending = new Map(entries.filter((e) => !e.version).map((e) => [key(e), e]));
const newest = entries
  .map((e) => e.version)
  .filter(Boolean)
  .sort(cmp)
  .at(-1);
const tags = execFileSync('git', ['-C', repo, 'tag', '-l', 'v[0-9]*'], { encoding: 'utf8' })
  .split('\n')
  .map((t) => t.trim())
  .filter((t) => /^v\d+\.\d+\.\d+$/.test(t))
  .map((t) => t.slice(1))
  .filter((v) => !newest || cmp(v, newest) > 0)
  .sort(cmp);

const found = new Map();
for (const v of tags) {
  if (found.size === pending.size) break;
  for (const e of await entriesAt(repo, `v${v}`)) {
    const k = key(e);
    if (pending.has(k) && !found.has(k)) found.set(k, v);
  }
}
if (current) for (const k of pending.keys()) if (!found.has(k)) found.set(k, current);

// grava no texto: `version` logo antes do `kind` de cada entrada encontrada
let src = readFileSync(CHANGELOG, 'utf8');
let n = 0;
src = src.replace(/ {2}\{\n([\s\S]*?)\n {2}\},\n/g, (block, body) => {
  if (/\n\s*version:/.test(`\n${body}`)) return block;
  const date = body.match(/date: '([^']+)'/)?.[1];
  const time = body.match(/time: '([^']+)'/)?.[1];
  const entry = entries.find(
    (e) =>
      e.date === date &&
      (e.time ?? undefined) === time &&
      body.includes(JSON.stringify(e.title).slice(1, -1).replace(/\\"/g, '"')),
  );
  const v = entry && found.get(key(entry));
  if (!v) return block;
  n++;
  return block.replace(/\n {4}kind:/, `\n    version: '${v}',\n    kind:`);
});
writeFileSync(CHANGELOG, src);
console.log(`${n} novidades carimbadas (${tags.length} tags olhadas); ${pending.size - n} sem versão`);
