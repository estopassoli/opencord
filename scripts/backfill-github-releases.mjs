#!/usr/bin/env node
// Cria retroativamente uma release no GitHub para cada versão do app que o workflow "Desktop (instaladores)" já
// publicou (versão = 0.2.<número do run>, nos pushes bem-sucedidos no main), com as novidades do changelog que
// entraram entre uma publicação e a anterior. Idempotente: pula releases que já existem.
//
// Uso: node scripts/backfill-github-releases.mjs [--dry-run] [--map-old <ref-antigo> --map-new <ref-novo>]
//   --map-old/--map-new: se o histórico foi reescrito (mesmos commits, shas novos), mapeia o sha antigo do run
//   para o novo comparando as duas linhagens posição a posição.
// Precisa do `gh` autenticado com permissão de escrever no repositório. Rode da raiz do repositório.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { entriesBetween, toMarkdown } from '../apps/desktop/scripts/release-notes.mjs';

const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const flag = (n) => {
  const i = args.indexOf(n);
  return i === -1 ? undefined : args[i + 1];
};
const sh = (cmd, a) => execFileSync(cmd, a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const repo = sh('gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']).trim();

/** sha antigo → novo, quando o histórico foi reescrito com os mesmos commits na mesma ordem */
function shaMap() {
  const oldRef = flag('--map-old');
  const newRef = flag('--map-new');
  if (!oldRef || !newRef) return new Map();
  const list = (ref) => sh('git', ['rev-list', '--reverse', ref]).trim().split('\n');
  const a = list(oldRef);
  const b = list(newRef);
  if (a.length !== b.length) throw new Error(`linhagens com tamanhos diferentes (${a.length} ≠ ${b.length})`);
  const subject = (sha) => sh('git', ['log', '-1', '--format=%s%n%at', sha]);
  const map = new Map();
  for (let i = 0; i < a.length; i++) {
    if (subject(a[i]) !== subject(b[i])) throw new Error(`commit ${i} difere entre as linhagens: ${a[i]} × ${b[i]}`);
    map.set(a[i], b[i]);
  }
  return map;
}

const map = shaMap();
const resolve = (sha) => map.get(sha) ?? sha;
const fmtDate = (iso) =>
  new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });

const runs = JSON.parse(
  sh('gh', [
    'run',
    'list',
    '--workflow',
    'desktop.yml',
    '--branch',
    'main',
    '--limit',
    '500',
    '--json',
    'number,headSha,createdAt,event,conclusion,url',
  ]),
)
  .filter((r) => r.event === 'push' && r.conclusion === 'success')
  .sort((x, y) => x.number - y.number);

const existing = new Set(
  JSON.parse(sh('gh', ['release', 'list', '--limit', '1000', '--json', 'tagName'])).map((r) => r.tagName),
);

// a primeira versão publicada foi a tag v0.2.0 (antes do número de run entrar na versão)
const releases = [];
const firstTag = sh('git', ['rev-parse', '--verify', '--quiet', 'v0.2.0^{commit}']).trim();
if (firstTag) releases.push({ tag: 'v0.2.0', sha: firstTag, createdAt: null, url: null, number: null });
for (const r of runs) releases.push({ tag: `v0.2.${r.number}`, sha: resolve(r.headSha), ...r });

const dir = mkdtempSync(join(tmpdir(), 'oc-releases-'));
let created = 0;
try {
  for (let i = 0; i < releases.length; i++) {
    const rel = releases[i];
    const prev = releases[i - 1];
    const last = i === releases.length - 1;
    const version = rel.tag.slice(1);
    if (existing.has(rel.tag)) {
      console.log(`= ${rel.tag} já existe`);
      continue;
    }
    const entries = await entriesBetween(process.cwd(), prev?.sha, rel.sha);
    let body = toMarkdown(entries);
    body += rel.createdAt
      ? `\n---\n_Compilado em ${fmtDate(rel.createdAt)} pelo run #${rel.number} ([log](${rel.url})). Os instaladores desta versão ficaram como artefatos do run (expiram em 90 dias); a partir desta mudança, cada release traz os instaladores anexados._\n`
      : '\n---\n_Primeira versão publicada (tag v0.2.0, 29/10/2026)._\n';
    const file = join(dir, `${rel.tag}.md`);
    writeFileSync(file, body);
    console.log(`+ ${rel.tag} @ ${rel.sha.slice(0, 7)} (${entries.length} novidades)${dry ? ' [dry-run]' : ''}`);
    if (dry) continue;
    sh('gh', [
      'release',
      'create',
      rel.tag,
      '--repo',
      repo,
      '--target',
      rel.sha,
      '--title',
      `OpenCord ${version}`,
      '--notes-file',
      file,
      last ? '--latest' : '--latest=false',
    ]);
    created++;
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log(dry ? `dry-run: ${releases.length} versões` : `${created} releases criadas`);
