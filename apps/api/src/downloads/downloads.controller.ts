import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { Controller, Get, Inject, NotFoundException, Param, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { Public } from '../common/auth.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';

export interface DesktopDownload {
  windows: { url: string; fileName: string | null; version: string | null; sizeBytes: number | null } | null;
}

/** Só instaladores .exe com nome simples (sem caminhos); evita servir qualquer outro arquivo da pasta. */
const SAFE_NAME = /^[\w .()-]{1,120}\.exe$/i;

@Controller('downloads')
export class DownloadsController {
  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  private async latestInstaller(): Promise<{ name: string; size: number } | null> {
    const dir = this.cfg.DOWNLOADS_DIR;
    if (!dir) return null;
    const files = await readdir(dir).catch(() => [] as string[]);
    let best: { name: string; size: number; mtime: number } | null = null;
    for (const name of files) {
      if (!SAFE_NAME.test(name)) continue;
      const st = await stat(path.join(dir, name)).catch(() => null);
      if (st?.isFile() && (!best || st.mtimeMs > best.mtime)) best = { name, size: st.size, mtime: st.mtimeMs };
    }
    return best;
  }

  /** Para o botão "Baixar para Windows" exibido a quem usa pelo navegador. */
  @Public()
  @Get('desktop')
  async desktop(): Promise<DesktopDownload> {
    if (this.cfg.DESKTOP_DOWNLOAD_URL) {
      return { windows: { url: this.cfg.DESKTOP_DOWNLOAD_URL, fileName: null, version: null, sizeBytes: null } };
    }
    const f = await this.latestInstaller();
    if (!f) return { windows: null };
    const version = f.name.match(/(\d+\.\d+\.\d+)/)?.[1] ?? null;
    return {
      windows: {
        url: `${this.cfg.PUBLIC_API_URL}/downloads/files/${encodeURIComponent(f.name)}`,
        fileName: f.name,
        version,
        sizeBytes: f.size,
      },
    };
  }

  @Public()
  @Get('files/:name')
  async file(@Param('name') name: string, @Res() reply: FastifyReply) {
    const dir = this.cfg.DOWNLOADS_DIR;
    if (!dir || !SAFE_NAME.test(name) || name !== path.basename(name)) throw new NotFoundException();
    const full = path.join(dir, name);
    const st = await stat(full).catch(() => null);
    if (!st?.isFile()) throw new NotFoundException();
    return reply
      .header('Content-Type', 'application/vnd.microsoft.portable-executable')
      .header('Content-Length', String(st.size))
      .header('Content-Disposition', `attachment; filename="${name.replace(/"/g, '')}"`)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'public, max-age=300')
      .send(createReadStream(full));
  }
}
