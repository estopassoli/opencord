// Gera src/lib/emoji-data.json (seletor de emojis): os emojis do Unicode com nome e palavras em português, do
// emojibase-data. Só até o Emoji 12.1 — o que o Windows 10 desenha; mais novos virariam quadradinhos. Sem tons de pele
// e sem as peças soltas (grupo "componentes"). Formato: [emoji, nome, palavras, grupo], na ordem oficial.
// Uso: node scripts/build-emoji-data.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const data = JSON.parse(readFileSync(require.resolve('emojibase-data/pt/data.json'), 'utf8'));
const MAX_VERSION = 12.1;
const rows = data
  .filter((e) => e.group !== undefined && e.group !== 2 && e.version <= MAX_VERSION)
  .sort((a, b) => a.order - b.order)
  .map((e) => [e.emoji, e.label, (e.tags ?? []).join(' '), e.group]);
writeFileSync(new URL('../src/lib/emoji-data.json', import.meta.url), JSON.stringify(rows));
console.log(`${rows.length} emojis`);
