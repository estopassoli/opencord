import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config.js';

/** Armazenamento em disco local. Chaves são geradas pelo servidor (nunca derivadas do nome enviado). */
@Injectable()
export class StorageService {
  private readonly root: string;
  constructor(@Inject(APP_CONFIG) cfg: AppConfig) {
    this.root = path.resolve(cfg.STORAGE_LOCAL_DIR);
  }

  private resolve(key: string): string {
    if (!/^[0-9a-z/_-]+$/i.test(key) || key.includes('..')) throw new Error('chave de armazenamento inválida');
    const p = path.resolve(this.root, key);
    if (!p.startsWith(this.root + path.sep)) throw new Error('chave fora do diretório');
    return p;
  }

  async write(key: string, source: Readable): Promise<void> {
    const p = this.resolve(key);
    await mkdir(path.dirname(p), { recursive: true });
    await pipeline(source, createWriteStream(p, { flags: 'wx' }));
  }

  read(key: string): Readable {
    return createReadStream(this.resolve(key));
  }

  async size(key: string): Promise<number> {
    return (await stat(this.resolve(key))).size;
  }

  async remove(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }
}
