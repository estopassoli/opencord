// Próxima versão do app (SemVer) a partir da última release e dos commits desde ela (Conventional Commits):
//   - mudança incompatível (`tipo!:` ou `BREAKING CHANGE:` no corpo) → MAJOR
//   - `feat` → MINOR
//   - qualquer outro (fix, perf, refactor, docs, chore, test…) → PATCH
//   - `Release-As: X.Y.Z` no corpo de um commit fixa a versão (como no release-please), se for maior que a última
// Só contam os commits que mexem no app (os mesmos caminhos que disparam o desktop.yml).
//
// Uso (da raiz do repositório, com o histórico e as tags baixados):
//   node apps/desktop/scripts/next-version.mjs   → imprime a versão, ex.: 0.4.0
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const APP_PATHS = [
  'apps/desktop',
  'apps/desktop-tauri',
  'packages',
  'pnpm-lock.yaml',
  '.github/workflows/desktop.yml',
];

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

export function parseVersion(v) {
  const m = SEMVER.exec(v);
  if (!m) throw new Error(`versão fora do SemVer: ${v}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function compareVersions(a, b) {
  const [x, y] = [parseVersion(a), parseVersion(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/** 'major' | 'minor' | 'patch' de uma mensagem de commit (assunto + corpo) */
export function bumpOf(message) {
  const [subject = '', ...body] = message.split('\n');
  const head = /^(\w+)(?:\([^)]*\))?(!)?:/.exec(subject.trim());
  if (head?.[2] || body.some((l) => /^BREAKING[ -]CHANGE:/.test(l.trim()))) return 'major';
  if (head?.[1] === 'feat') return 'minor';
  return 'patch';
}

/** a maior versão pedida com `Release-As: X.Y.Z` no corpo dos commits, ou undefined */
export function releaseAs(messages) {
  const asked = messages.flatMap((m) =>
    m
      .split('\n')
      .slice(1)
      .map((l) => /^Release-As:\s*v?(\d+\.\d+\.\d+)\s*$/i.exec(l.trim())?.[1])
      .filter(Boolean),
  );
  return asked.sort(compareVersions).at(-1);
}

/**
 * a versão seguinte a `prev` para estes commits; sem commits, sobe o patch (uma build nova nunca repete versão).
 * `Release-As` vence o cálculo quando é maior que `prev` (menor ou igual seria repetir/voltar versão: é ignorado).
 */
export function nextVersion(prev, messages) {
  const forced = releaseAs(messages);
  if (forced && compareVersions(forced, prev) > 0) return forced;
  if (forced) console.error(`Release-As ${forced} ignorado: não é maior que ${prev}`);
  const [major, minor, patch] = parseVersion(prev);
  const kinds = new Set(messages.map(bumpOf));
  if (kinds.has('major')) return `${major + 1}.0.0`;
  if (kinds.has('minor')) return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/** a maior tag vX.Y.Z do repositório (sem o v), ou undefined */
export function latestTag(repo = '.') {
  return execFileSync('git', ['-C', repo, 'tag', '-l', 'v[0-9]*'], { encoding: 'utf8' })
    .split('\n')
    .map((t) => t.trim().slice(1))
    .filter((v) => SEMVER.test(v))
    .sort(compareVersions)
    .at(-1);
}

function commitsSince(repo, tag) {
  const out = execFileSync('git', ['-C', repo, 'log', '--format=%B%x00', `v${tag}..HEAD`, '--', ...APP_PATHS], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return out
    .split('\0')
    .map((m) => m.trim())
    .filter(Boolean);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const repo = '.';
  const tag = latestTag(repo);
  if (!tag) {
    // sem release ainda: a versão do package.json do app
    console.log(JSON.parse(readFileSync('apps/desktop/package.json', 'utf8')).version);
  } else {
    console.log(nextVersion(tag, commitsSince(repo, tag)));
  }
}
