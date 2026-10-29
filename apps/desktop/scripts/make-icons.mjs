// Gera os ícones do OpenCord a partir do logotipo-fonte (resources/opencord-logo.png, fornecido pelo mantenedor):
// PNGs por tamanho (janela, bandeja, renderer) e build/icon.ico (PNGs embutidos) para o instalador.
// Requer ffmpeg no PATH. Uso: node scripts/make-icons.mjs
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const SRC = 'resources/opencord-logo.png';
const OUT = 'resources/icons';
const SIZES = [16, 24, 32, 48, 64, 128, 256, 512];
mkdirSync(OUT, { recursive: true });

for (const s of SIZES) {
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-i',
    SRC,
    '-vf',
    `scale=${s}:${s}:flags=lanczos`,
    path.join(OUT, `${s}.png`),
  ]);
}

/** ICO com imagens PNG embutidas (Windows Vista+). */
function buildIco(sizes) {
  const pngs = sizes.map((s) => readFileSync(path.join(OUT, `${s}.png`)));
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((s, i) => {
    const e = 6 + i * 16;
    header[e] = s >= 256 ? 0 : s;
    header[e + 1] = s >= 256 ? 0 : s;
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(pngs[i].length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += pngs[i].length;
  });
  return Buffer.concat([header, ...pngs]);
}

// versionados em resources/ (o CI do Windows não tem ffmpeg; rode este script só quando o logotipo mudar)
writeFileSync('resources/icon.ico', buildIco([16, 24, 32, 48, 64, 128, 256]));
copyFileSync(path.join(OUT, '512.png'), 'resources/icon.png');
// renderer (marca no rail/entrada + favicon)
copyFileSync(path.join(OUT, '128.png'), 'src/assets/logo.png');
copyFileSync(path.join(OUT, '64.png'), 'src/assets/favicon.png');
console.log(`ícones gerados: ${SIZES.join(', ')} px + resources/icon.ico`);
