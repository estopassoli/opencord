// Novidades que vão junto com os instaladores (CI → volume de downloads → GET /downloads/desktop/notes): o app
// instalado mostra o que entrou na versão nova antes de atualizar. Uso: node scripts/release-notes.mjs <saída.json>
// (Node 24 lê o changelog.ts direto, removendo os tipos).
import { writeFileSync } from 'node:fs';

const { CHANGELOG } = await import('../src/features/home/changelog.ts');
const out = process.argv[2];
if (!out) throw new Error('informe o arquivo de saída');
const entries = CHANGELOG.slice(0, 150).map(({ date, time, kind, title, body }) => ({ date, time, kind, title, body }));
writeFileSync(out, JSON.stringify({ entries }));
console.log(`${entries.length} novidades → ${out}`);
