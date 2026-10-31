import { createReadStream } from 'node:fs';
import { appendFile, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config.js';

/**
 * Armazenamento de arquivos (anexos, fotos, imagens de servidor). Chaves são geradas pelo servidor (nunca derivadas
 * do nome enviado). Drivers: `local` (disco/volume) ou `s3` (S3 compatível, ex.: Cloudflare R2; ADR-0010).
 * O bucket fica privado: a API continua servindo os arquivos, com as mesmas verificações de acesso.
 */
@Injectable()
export class StorageService {
  private readonly root: string;
  private readonly s3: S3Client | null;
  private readonly bucket: string;

  constructor(@Inject(APP_CONFIG) cfg: AppConfig) {
    this.root = path.resolve(cfg.STORAGE_LOCAL_DIR);
    this.bucket = cfg.S3_BUCKET ?? '';
    this.s3 =
      cfg.STORAGE_DRIVER === 's3'
        ? new S3Client({
            region: cfg.S3_REGION,
            endpoint: cfg.S3_ENDPOINT,
            forcePathStyle: cfg.S3_FORCE_PATH_STYLE,
            credentials: { accessKeyId: cfg.S3_ACCESS_KEY_ID ?? '', secretAccessKey: cfg.S3_SECRET_ACCESS_KEY ?? '' },
          })
        : null;
  }

  private check(key: string): string {
    if (!/^[0-9a-z/_-]+$/i.test(key) || key.includes('..')) throw new Error('chave de armazenamento inválida');
    return key;
  }

  private resolve(key: string): string {
    const p = path.resolve(this.root, this.check(key));
    if (!p.startsWith(this.root + path.sep)) throw new Error('chave fora do diretório');
    return p;
  }

  async write(key: string, data: Buffer, contentType = 'application/octet-stream'): Promise<void> {
    if (this.s3) {
      await this.s3.send(
        new PutObjectCommand({ Bucket: this.bucket, Key: this.check(key), Body: data, ContentType: contentType }),
      );
      return;
    }
    const p = this.resolve(key);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, data, { flag: 'wx' });
  }

  async read(key: string): Promise<Readable> {
    if (this.s3) {
      const r = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.check(key) }));
      if (!(r.Body instanceof Readable)) throw new Error('resposta do armazenamento sem corpo');
      return r.Body;
    }
    return createReadStream(this.resolve(key));
  }

  async size(key: string): Promise<number> {
    if (this.s3) {
      const r = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: this.check(key) }));
      return r.ContentLength ?? 0;
    }
    return (await stat(this.resolve(key))).size;
  }

  // ---------- envio em partes (gravações de chamada, ADR-0023) ----------
  // S3: multipart (cada parte ≥ 5 MB, menos a última). Disco: as partes chegam em ordem e são anexadas ao arquivo.

  /** Começa um envio em partes; devolve o id do envio no S3 (null no disco). */
  async partsBegin(key: string, contentType: string): Promise<string | null> {
    if (this.s3) {
      const r = await this.s3.send(
        new CreateMultipartUploadCommand({ Bucket: this.bucket, Key: this.check(key), ContentType: contentType }),
      );
      if (!r.UploadId) throw new Error('armazenamento não abriu o envio em partes');
      return r.UploadId;
    }
    const p = this.resolve(key);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, Buffer.alloc(0), { flag: 'wx' });
    return null;
  }

  /** Envia a parte `n` (1, 2, 3…, sempre em ordem); devolve a etiqueta que o S3 pede no fim. */
  async partsPut(key: string, uploadId: string | null, n: number, data: Buffer): Promise<string> {
    if (this.s3) {
      const r = await this.s3.send(
        new UploadPartCommand({
          Bucket: this.bucket,
          Key: this.check(key),
          UploadId: uploadId ?? '',
          PartNumber: n,
          Body: data,
        }),
      );
      return r.ETag ?? '';
    }
    await appendFile(this.resolve(key), data);
    return '';
  }

  async partsComplete(key: string, uploadId: string | null, parts: { n: number; etag: string }[]): Promise<void> {
    if (!this.s3) return;
    await this.s3.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: this.check(key),
        UploadId: uploadId ?? '',
        MultipartUpload: { Parts: parts.map((p) => ({ PartNumber: p.n, ETag: p.etag })) },
      }),
    );
  }

  async partsAbort(key: string, uploadId: string | null): Promise<void> {
    if (this.s3) {
      await this.s3.send(
        new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: this.check(key), UploadId: uploadId ?? '' }),
      );
      return;
    }
    await rm(this.resolve(key), { force: true });
  }

  async remove(key: string): Promise<void> {
    if (this.s3) {
      await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.check(key) }));
      return;
    }
    await rm(this.resolve(key), { force: true });
  }
}
