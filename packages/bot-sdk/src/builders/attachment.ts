import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import type { UploadFile } from '../rest.js';

/** `Buffer`, caminho de arquivo, URL (http(s) ou `URL`), `Blob`/`File` ou stream (web ou Node) */
export type AttachmentData =
  Buffer | Uint8Array | ArrayBuffer | string | URL | Blob | ReadableStream<Uint8Array> | NodeJS.ReadableStream;

export interface AttachmentBuilderData {
  name?: string | null;
  /** aceito e ignorado (o OpenCord não tem texto alternativo por anexo) */
  description?: string | null;
}

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.txt': 'text/plain',
  '.md': 'text/plain',
  '.log': 'text/plain',
  '.csv': 'text/plain',
  '.json': 'text/plain',
};

/** tipo MIME pela extensão (os que a API aceita); vazio quando desconhecido */
export function mimeOf(name: string): string {
  return MIME_BY_EXT[extname(name).toLowerCase()] ?? '';
}

function isNodeStream(v: unknown): v is NodeJS.ReadableStream {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as NodeJS.ReadableStream).pipe === 'function' &&
    Symbol.asyncIterator in v
  );
}

async function collect(stream: AsyncIterable<Uint8Array | string>): Promise<Uint8Array[]> {
  const chunks: Uint8Array[] = [];
  for await (const c of stream) chunks.push(typeof c === 'string' ? new TextEncoder().encode(c) : c);
  return chunks;
}

/** Arquivo para enviar numa mensagem (`files: [new AttachmentBuilder(buffer, { name: 'x.png' })]`). */
export class AttachmentBuilder {
  attachment: AttachmentData;
  name: string | null;
  description: string | null;
  spoiler = false;

  constructor(attachment: AttachmentData, data: AttachmentBuilderData = {}) {
    this.attachment = attachment;
    this.name = data.name ?? null;
    this.description = data.description ?? null;
  }

  setName(name: string) {
    this.name = name;
    return this;
  }
  setDescription(description: string) {
    this.description = description;
    return this;
  }
  setFile(attachment: AttachmentData, name?: string) {
    this.attachment = attachment;
    if (name) this.name = name;
    return this;
  }
  /** aceito e ignorado (sem spoiler no OpenCord) */
  setSpoiler(spoiler = true) {
    this.spoiler = spoiler;
    return this;
  }

  /** Lê o conteúdo (arquivo, URL, stream) e devolve nome + Blob prontos para o multipart. */
  async toFile(): Promise<UploadFile> {
    const a = this.attachment;
    let data: Blob;
    let name = this.name ?? null;
    if (typeof a === 'string' || a instanceof URL) {
      const s = String(a);
      if (/^https?:\/\//i.test(s)) {
        const res = await fetch(s);
        if (!res.ok) throw new Error(`não consegui baixar ${s}: HTTP ${res.status}`);
        data = await res.blob();
        name ??= basename(new URL(s).pathname) || 'file';
      } else {
        const path = a instanceof URL ? a : s;
        const buf = await readFile(path);
        name ??= basename(String(path));
        data = new Blob([buf], { type: mimeOf(name) });
      }
    } else if (typeof Blob !== 'undefined' && a instanceof Blob) {
      data = a;
      name ??= (a as File).name || 'file';
    } else if (a instanceof ArrayBuffer || ArrayBuffer.isView(a)) {
      name ??= 'file';
      const bytes = a instanceof ArrayBuffer ? new Uint8Array(a) : new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
      data = new Blob([bytes], { type: mimeOf(name) });
    } else if (typeof ReadableStream !== 'undefined' && a instanceof ReadableStream) {
      name ??= 'file';
      data = new Blob(await collect(a as unknown as AsyncIterable<Uint8Array>), { type: mimeOf(name) });
    } else if (isNodeStream(a)) {
      name ??= 'file';
      data = new Blob(await collect(a as unknown as AsyncIterable<Uint8Array | string>), { type: mimeOf(name) });
    } else {
      throw new Error('anexo inválido: use Buffer, caminho, URL, Blob ou stream');
    }
    if (!data.type && name) {
      const type = mimeOf(name);
      if (type) data = new Blob([await data.arrayBuffer()], { type });
    }
    return { name, data };
  }
}

/** o que `files` aceita: builder, dado cru ou `{ attachment, name }` */
export type FileResolvable =
  AttachmentBuilder | AttachmentData | { attachment: AttachmentData; name?: string; description?: string };

export function toAttachmentBuilder(f: FileResolvable): AttachmentBuilder {
  if (f instanceof AttachmentBuilder) return f;
  if (
    typeof f === 'object' &&
    f !== null &&
    'attachment' in f &&
    !(f instanceof URL) &&
    !(f instanceof Blob) &&
    !Buffer.isBuffer(f)
  )
    return new AttachmentBuilder(f.attachment, { name: f.name, description: f.description });
  return new AttachmentBuilder(f as AttachmentData);
}
