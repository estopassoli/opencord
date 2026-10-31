import { createReadStream } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { Controller, Get, Inject, NotFoundException, Param, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { Public } from '../common/auth.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';

export type DesktopPlatform = 'windows' | 'mac' | 'linux';
export type DesktopArch = 'x64' | 'arm64';
export type DesktopFormat = 'exe' | 'dmg' | 'AppImage' | 'deb';

export interface DesktopFile {
  platform: DesktopPlatform;
  arch: DesktopArch;
  format: DesktopFormat;
  url: string;
  fileName: string | null;
  version: string | null;
  sizeBytes: number | null;
}

export interface DesktopDownload {
  /** Instalador Windows (mantido à parte para clientes antigos). */
  windows: DesktopFile | null;
  /** Versão mais recente de cada plataforma/arquitetura/formato publicada. */
  files: DesktopFile[];
}

/** Só instaladores com nome simples (sem caminhos); evita servir qualquer outro arquivo da pasta. */
const SAFE_NAME = /^[\w .()-]{1,120}\.(exe|dmg|AppImage|deb)$/i;

const FORMATS: Record<string, { platform: DesktopPlatform; format: DesktopFormat; mime: string }> = {
  exe: { platform: 'windows', format: 'exe', mime: 'application/vnd.microsoft.portable-executable' },
  dmg: { platform: 'mac', format: 'dmg', mime: 'application/x-apple-diskimage' },
  appimage: { platform: 'linux', format: 'AppImage', mime: 'application/octet-stream' },
  deb: { platform: 'linux', format: 'deb', mime: 'application/vnd.debian.binary-package' },
};

const ORDER: DesktopPlatform[] = ['windows', 'mac', 'linux'];

/** Novidades publicadas junto com os instaladores pelo CI: `OpenCord-notes-<versão>.json`. */
const NOTES_NAME = /^OpenCord-notes-(\d+)\.(\d+)\.(\d+)\.json$/;

export interface ReleaseNote {
  date: string;
  time?: string;
  kind: string;
  title: string;
  body: string;
}
export interface ReleaseNotes {
  version: string;
  entries: ReleaseNote[];
}

const str = (v: unknown, max: number) => typeof v === 'string' && v.length > 0 && v.length <= max;
/** só os campos esperados (o arquivo vem do CI, mas a API não repassa nada além disto) */
export function cleanNotes(raw: unknown, version: string): ReleaseNotes {
  const list = Array.isArray((raw as { entries?: unknown })?.entries) ? (raw as { entries: unknown[] }).entries : [];
  const entries: ReleaseNote[] = [];
  for (const e of list.slice(0, 200)) {
    const o = e as Record<string, unknown>;
    if (!str(o.date, 10) || !str(o.kind, 20) || !str(o.title, 200) || !str(o.body, 2000)) continue;
    entries.push({
      date: o.date as string,
      ...(str(o.time, 5) ? { time: o.time as string } : {}),
      kind: o.kind as string,
      title: o.title as string,
      body: o.body as string,
    });
  }
  return { version, entries };
}

/** Plataforma/arquitetura pelo nome (padrão do electron-builder.yml; "OpenCord Setup x.y.z.exe" antigo = x64). */
export function classify(name: string): Omit<DesktopFile, 'url' | 'sizeBytes'> | null {
  const m = SAFE_NAME.exec(name);
  if (!m) return null;
  const f = FORMATS[m[1]!.toLowerCase()]!;
  return {
    platform: f.platform,
    format: f.format,
    arch: /(arm64|aarch64)/i.test(name) ? 'arm64' : 'x64',
    fileName: name,
    version: name.match(/(\d+\.\d+\.\d+)/)?.[1] ?? null,
  };
}

@Controller('downloads')
export class DownloadsController {
  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  private async latestFiles(): Promise<DesktopFile[]> {
    const dir = this.cfg.DOWNLOADS_DIR;
    if (!dir) return [];
    const names = await readdir(dir).catch(() => [] as string[]);
    const best = new Map<string, DesktopFile & { mtime: number }>();
    for (const name of names) {
      const c = classify(name);
      if (!c) continue;
      const st = await stat(path.join(dir, name)).catch(() => null);
      if (!st?.isFile()) continue;
      const key = `${c.platform}/${c.arch}/${c.format}`;
      const cur = best.get(key);
      if (cur && cur.mtime >= st.mtimeMs) continue;
      best.set(key, {
        ...c,
        url: `${this.cfg.PUBLIC_API_URL}/downloads/files/${encodeURIComponent(name)}`,
        sizeBytes: st.size,
        mtime: st.mtimeMs,
      });
    }
    return [...best.values()]
      .map(({ mtime: _mtime, ...f }) => f)
      .sort(
        (a, b) =>
          ORDER.indexOf(a.platform) - ORDER.indexOf(b.platform) ||
          a.arch.localeCompare(b.arch) ||
          a.format.localeCompare(b.format),
      );
  }

  /** Para os botões "Baixar para Windows/macOS/Linux" exibidos a quem usa pelo navegador. */
  @Public()
  @Get('desktop')
  async desktop(): Promise<DesktopDownload> {
    const files = await this.latestFiles();
    if (this.cfg.DESKTOP_DOWNLOAD_URL) {
      const windows: DesktopFile = {
        platform: 'windows',
        arch: 'x64',
        format: 'exe',
        url: this.cfg.DESKTOP_DOWNLOAD_URL,
        fileName: null,
        version: null,
        sizeBytes: null,
      };
      return { windows, files: [windows, ...files.filter((f) => f.platform !== 'windows')] };
    }
    return { windows: files.find((f) => f.platform === 'windows') ?? null, files };
  }

  /** Novidades da versão mais recente publicada (o app mostra antes de atualizar). */
  @Public()
  @Get('desktop/notes')
  async notes(): Promise<ReleaseNotes> {
    const dir = this.cfg.DOWNLOADS_DIR;
    if (!dir) throw new NotFoundException();
    const names = await readdir(dir).catch(() => [] as string[]);
    let best: { name: string; v: number[] } | null = null;
    for (const name of names) {
      const m = NOTES_NAME.exec(name);
      if (!m) continue;
      const v = [Number(m[1]), Number(m[2]), Number(m[3])];
      const cmp = best ? v[0]! - best.v[0]! || v[1]! - best.v[1]! || v[2]! - best.v[2]! : 1;
      if (cmp > 0) best = { name, v };
    }
    if (!best) throw new NotFoundException();
    const raw = JSON.parse(await readFile(path.join(dir, best.name), 'utf8')) as unknown;
    return cleanNotes(raw, best.v.join('.'));
  }

  @Public()
  @Get('files/:name')
  async file(@Param('name') name: string, @Res() reply: FastifyReply) {
    const dir = this.cfg.DOWNLOADS_DIR;
    const ext = SAFE_NAME.exec(name)?.[1];
    if (!dir || !ext || name !== path.basename(name)) throw new NotFoundException();
    const full = path.join(dir, name);
    const st = await stat(full).catch(() => null);
    if (!st?.isFile()) throw new NotFoundException();
    return reply
      .header('Content-Type', FORMATS[ext.toLowerCase()]!.mime)
      .header('Content-Length', String(st.size))
      .header('Content-Disposition', `attachment; filename="${name.replace(/"/g, '')}"`)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'public, max-age=300')
      .send(createReadStream(full));
  }
}
