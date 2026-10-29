import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
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
