/**
 * Fontes importadas pelo usuário (Aparência → Importar fonte).
 * Ficam só neste computador (IndexedDB do perfil do app) e nunca vão para o servidor, o instalador
 * ou o repositório: o usuário é responsável pela licença do arquivo que importa.
 */
import { create } from 'zustand';

export interface FontFile {
  name: string;
  weight: string;
  style: 'normal' | 'italic';
  data: ArrayBuffer;
}
export interface ImportedFont {
  family: string;
  files: FontFile[];
}

export const MAX_FONT_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_FONT_FILES = 24;
export const FONT_ACCEPT = '.woff2,.woff,.ttf,.otf';

/** Formato real pelos primeiros bytes (a extensão não basta). */
export function sniffFontFormat(bytes: Uint8Array): 'woff2' | 'woff' | 'truetype' | 'opentype' | null {
  if (bytes.length < 4) return null;
  const tag = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!);
  if (tag === 'wOF2') return 'woff2';
  if (tag === 'wOFF') return 'woff';
  if (tag === 'OTTO') return 'opentype';
  if (tag === 'true' || (bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0)) return 'truetype';
  return null;
}

const WEIGHTS: [RegExp, string][] = [
  [/(extra|ultra)[-_ ]?black|heavy/i, '900'],
  [/black/i, '900'],
  [/(extra|ultra)[-_ ]?bold/i, '800'],
  [/(semi|demi)[-_ ]?bold/i, '600'],
  [/bold/i, '700'],
  [/medium/i, '500'],
  [/(extra|ultra)[-_ ]?light/i, '200'],
  [/thin|hairline/i, '100'],
  [/light/i, '300'],
];

/** Peso e estilo a partir do nome do arquivo (ex.: "MinhaFonte-SemiBoldItalic.woff2" → 600 itálico). */
export function faceFromFileName(fileName: string): { weight: string; style: 'normal' | 'italic' } {
  const base = fileName.replace(/\.[^.]+$/, '');
  const weight = WEIGHTS.find(([re]) => re.test(base))?.[1] ?? '400';
  return { weight, style: /italic|oblique/i.test(base) ? 'italic' : 'normal' };
}

/** Sugestão de nome de família: tira extensão e palavras de peso/estilo ("ggsansbolditalic" → "ggsans"). */
export function familyFromFileName(fileName: string): string {
  return (
    fileName
      .replace(/\.[^.]+$/, '')
      .replace(
        /[-_ ]?((extra|ultra|semi|demi)[-_ ]?)?(black|heavy|bold|medium|regular|normal|book|light|thin|hairline|italic|oblique)/gi,
        '',
      )
      .replace(/[^\p{L}\p{N} ._-]/gu, '')
      .trim() || 'Fonte importada'
  );
}

// ---------------------------------------------------------------------------
// IndexedDB
// ---------------------------------------------------------------------------
const DB = 'oc-fonts';
const STORE = 'fonts';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'family' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = run(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// Registro no documento + estado para a UI
// ---------------------------------------------------------------------------
const registered = new Map<string, FontFace[]>();

async function register(font: ImportedFont) {
  unregister(font.family);
  const faces = font.files.map((f) => new FontFace(font.family, f.data, { weight: f.weight, style: f.style }));
  const loaded = await Promise.all(faces.map((f) => f.load().catch(() => null)));
  const ok = loaded.filter((f): f is FontFace => f !== null);
  for (const f of ok) document.fonts.add(f);
  registered.set(font.family, ok);
  return ok.length;
}

function unregister(family: string) {
  for (const f of registered.get(family) ?? []) document.fonts.delete(f);
  registered.delete(family);
}

export const useImportedFonts = create<{ families: string[] }>(() => ({ families: [] }));

const refresh = () => useImportedFonts.setState({ families: [...registered.keys()].sort() });

/** Registra as fontes guardadas (chamar na inicialização). Falhas não impedem o app de abrir. */
export async function loadImportedFonts(): Promise<void> {
  try {
    const all = await tx<ImportedFont[]>('readonly', (s) => s.getAll() as IDBRequest<ImportedFont[]>);
    await Promise.all(all.map(register));
  } catch {
    /* IndexedDB indisponível: segue com as fontes do sistema */
  }
  refresh();
}

export class FontImportError extends Error {}

/** Valida, guarda e registra os arquivos como uma família. */
export async function importFont(family: string, files: File[]): Promise<void> {
  const name = family.trim();
  if (!name || name.length > 64 || !/^[\p{L}\p{N} ._-]+$/u.test(name))
    throw new FontImportError('Nome inválido: use letras, números, espaço, ponto, hífen ou _ (até 64).');
  if (files.length === 0) throw new FontImportError('Escolha ao menos um arquivo.');
  if (files.length > MAX_FONT_FILES) throw new FontImportError(`No máximo ${MAX_FONT_FILES} arquivos por fonte.`);
  const out: FontFile[] = [];
  for (const file of files) {
    if (file.size > MAX_FONT_FILE_BYTES) throw new FontImportError(`${file.name}: maior que 5 MB.`);
    const data = await file.arrayBuffer();
    if (!sniffFontFormat(new Uint8Array(data, 0, Math.min(4, data.byteLength))))
      throw new FontImportError(`${file.name}: não é uma fonte WOFF2, WOFF, TTF ou OTF.`);
    out.push({ name: file.name, data, ...faceFromFileName(file.name) });
  }
  const font: ImportedFont = { family: name, files: out };
  if ((await register(font)) === 0) {
    unregister(name);
    throw new FontImportError('O navegador não conseguiu ler esses arquivos de fonte.');
  }
  await tx('readwrite', (s) => s.put(font));
  refresh();
}

export async function removeImportedFont(family: string): Promise<void> {
  unregister(family);
  await tx('readwrite', (s) => s.delete(family));
  refresh();
}
