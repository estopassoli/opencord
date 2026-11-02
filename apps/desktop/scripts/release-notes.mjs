// Novidades que vão junto com os instaladores (CI → volume de downloads → GET /downloads/desktop/notes): o app
// instalado mostra o que entrou na versão nova antes de atualizar.
//
// Usos:
//   node scripts/release-notes.mjs <saída.json>
//       JSON com as 150 novidades mais recentes do changelog atual (como sempre foi).
//   node scripts/release-notes.mjs --markdown --to <ref> [--from <ref>] [--repo <dir>] [--title <texto>]
//       Markdown (para a release do GitHub) só com as novidades que entraram no changelog entre `from` e `to`
//       (refs do git: sha, tag ou branch). Sem `from`, todas as novidades presentes em `to`. Sai no stdout.
//       (Node 24 lê o changelog.ts direto, removendo os tipos.)
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const CHANGELOG_PATH = 'apps/desktop/src/features/home/changelog.ts';
const KIND_TITLE = { novo: 'Novo', melhoria: 'Melhorias', correção: 'Correções' };

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};

/** Lê o changelog de um ref do git (ou do disco, sem ref) e devolve as entradas. */
async function entriesAt(repo, ref) {
  if (!ref) {
    const { CHANGELOG } = await import('../src/features/home/changelog.ts');
    return CHANGELOG;
  }
  let source;
  try {
    source = execFileSync('git', ['-C', repo, 'show', `${ref}:${CHANGELOG_PATH}`], { encoding: 'utf8', stdio: 'pipe' });
  } catch {
    // commit anterior ao changelog (ou caminho antigo): nada para listar
    return [];
  }
  const dir = mkdtempSync(join(tmpdir(), 'oc-changelog-'));
  const file = join(dir, `changelog-${Math.random().toString(36).slice(2)}.ts`);
  // o `import type { IconName }` é removido pelo Node; nada mais é importado pelo changelog
  writeFileSync(file, source);
  try {
    const { CHANGELOG } = await import(pathToFileURL(file).href);
    return CHANGELOG;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const key = (e) => `${e.date}|${e.time ?? ''}|${e.title}`;

/** Novidades presentes em `to` e ausentes em `from` (mais recente primeiro, como no changelog). */
export async function entriesBetween(repo, from, to) {
  const now = await entriesAt(repo, to);
  if (!from) return now;
  let before = [];
  try {
    before = await entriesAt(repo, from);
  } catch {
    before = [];
  }
  const seen = new Set(before.map(key));
  return now.filter((e) => !seen.has(key(e)));
}

/** `@nome` e `#123` virariam menção a pessoa/issue do GitHub: vão em código para ficarem só texto. */
export function escapeMentions(text) {
  return text.replace(/(^|[^`\w])([@#][\p{L}\p{N}_-]+)/gu, (_, before, token) => `${before}\`${token}\``);
}

export function toMarkdown(entries, title) {
  const lines = [];
  if (title) lines.push(`## ${title}`, '');
  if (!entries.length) {
    lines.push('_Sem novidades visíveis nesta versão (só mudanças internas)._');
    return lines.join('\n') + '\n';
  }
  for (const kind of ['novo', 'melhoria', 'correção']) {
    const list = entries.filter((e) => e.kind === kind);
    if (!list.length) continue;
    lines.push(`### ${KIND_TITLE[kind]}`, '');
    for (const e of list) lines.push(`- **${escapeMentions(e.title)}** — ${escapeMentions(e.body)}`);
    lines.push('');
  }
  return lines.join('\n');
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (!isMain) {
  // importado como módulo (backfill): nada a fazer
} else if (args.includes('--markdown')) {
  const to = flag('--to');
  if (!to) throw new Error('informe --to <ref>');
  const repo = flag('--repo') ?? process.cwd();
  const entries = await entriesBetween(repo, flag('--from'), to);
  process.stdout.write(toMarkdown(entries, flag('--title')));
} else if (args[0] && !args[0].startsWith('--')) {
  const out = args[0];
  const entries = (await entriesAt()).slice(0, 150).map(({ date, time, kind, title, body }) => ({
    date,
    time,
    kind,
    title,
    body,
  }));
  writeFileSync(out, JSON.stringify({ entries }));
  console.log(`${entries.length} novidades → ${out}`);
} else {
  throw new Error('informe o arquivo de saída ou --markdown');
}
