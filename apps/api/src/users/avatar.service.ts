import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  PayloadTooLargeException,
} from '@nestjs/common';
import { rooms } from '@opencord/contracts';
import { imageSize } from '../attachments/attachments.service.js';
import { StorageService } from '../attachments/storage.service.js';
import { PrismaService } from '../common/prisma.service.js';
import { serverSummary, userPublic } from '../common/serialize.js';
import { RealtimeService } from '../realtime/realtime.service.js';

/** O app já recorta e reduz para 256×256; o limite é folgado para quem envia direto pela API. */
export const AVATAR_MAX_BYTES = 1024 * 1024;
const MAX_SIDE = 1024;
const AVATAR_LIMITS = { maxBytes: AVATAR_MAX_BYTES, maxSide: MAX_SIDE, label: '1 MB' };
const WALLPAPER_LIMITS = { maxBytes: 4 * 1024 * 1024, maxSide: 2560, label: '4 MB' };
/** emojis personalizados (ADR-0050): GIF animado pequeno; o app reduz os parados para 128 px */
const EMOJI_LIMITS = { maxBytes: 512 * 1024, maxSide: 512, label: '512 KB' };
const BANNER_LIMITS = { maxBytes: 4 * 1024 * 1024, maxSide: 2560, label: '4 MB' };
/** fotos guardadas para voltar a usar (ADR-0048) */
const RECENT_AVATARS = 6;
const TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
/** nome guardado em users.avatarKey e servido em GET /avatars/:name (aleatório: muda a cada troca → cache eterno) */
export const AVATAR_NAME = /^[0-9a-f-]{36}-(png|jpeg|webp|gif)$/;

/**
 * Troca a chave da imagem só se ela ainda for a que foi lida (dois envios ao mesmo tempo não deixam arquivo órfão).
 * Devolve a chave anterior, que pode ser apagada.
 */
async function swapKey(
  read: () => Promise<string | null>,
  write: (old: string | null) => Promise<number>,
): Promise<string | null> {
  for (let i = 0; i < 5; i++) {
    const old = await read();
    if ((await write(old)) === 1) return old;
  }
  throw new ConflictException('a imagem foi alterada ao mesmo tempo; tente de novo');
}

@Injectable()
export class AvatarService {
  private readonly log = new Logger('Imagens');
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly realtime: RealtimeService,
  ) {}

  async set(userId: string, file: AsyncIterable<Buffer> & { truncated?: boolean }) {
    return this.apply(userId, await this.storeImage(file, 'avatars'));
  }

  /** Imagem do servidor (mesmas regras da foto de perfil); o nome vai para servers.iconKey. */
  async setServerIcon(serverId: string, file: AsyncIterable<Buffer> & { truncated?: boolean }) {
    return this.applyServer(serverId, await this.storeImage(file, 'server-icons'));
  }

  async clearServerIcon(serverId: string) {
    return this.applyServer(serverId, null);
  }

  /** Papel de parede da conversa (até 4 MB e 2560 px de lado; o app reduz antes de enviar). */
  async setServerWallpaper(serverId: string, file: AsyncIterable<Buffer> & { truncated?: boolean }) {
    return this.applyWallpaper(serverId, await this.storeImage(file, 'wallpapers', WALLPAPER_LIMITS));
  }

  async clearServerWallpaper(serverId: string) {
    return this.applyWallpaper(serverId, null);
  }

  /** Faixa do servidor e fundo do convite (ADR-0050): mesmas regras do papel de parede (até 4 MB, 2560 px). */
  async setServerImage(
    serverId: string,
    kind: 'banner' | 'invite-bg',
    file: (AsyncIterable<Buffer> & { truncated?: boolean }) | null,
  ) {
    const folder = kind === 'banner' ? 'server-banners' : 'invite-backgrounds';
    const name = file ? await this.storeImage(file, folder, WALLPAPER_LIMITS) : null;
    const column = kind === 'banner' ? 'bannerKey' : 'inviteBgKey';
    const prev = await swapKey(
      async () => (await this.prisma.server.findUniqueOrThrow({ where: { id: serverId } }))[column],
      async (old) =>
        (await this.prisma.server.updateMany({ where: { id: serverId, [column]: old }, data: { [column]: name } }))
          .count,
    );
    const server = await this.prisma.server.findUniqueOrThrow({ where: { id: serverId } });
    if (prev && AVATAR_NAME.test(prev)) await this.storage.remove(`${folder}/${prev}`).catch(() => undefined);
    this.realtime.emit(rooms.server(serverId), 'server:updated', serverSummary(server));
    return server;
  }

  private async applyWallpaper(serverId: string, name: string | null) {
    const prev = await swapKey(
      async () => (await this.prisma.server.findUniqueOrThrow({ where: { id: serverId } })).wallpaperKey,
      async (old) =>
        (
          await this.prisma.server.updateMany({
            where: { id: serverId, wallpaperKey: old },
            data: { wallpaperKey: name },
          })
        ).count,
    );
    const server = await this.prisma.server.findUniqueOrThrow({ where: { id: serverId } });
    if (prev && AVATAR_NAME.test(prev)) await this.storage.remove(`wallpapers/${prev}`).catch(() => undefined);
    this.realtime.emit(rooms.server(serverId), 'server:updated', serverSummary(server));
    return server;
  }

  private async applyServer(serverId: string, name: string | null) {
    const prev = await swapKey(
      async () => (await this.prisma.server.findUniqueOrThrow({ where: { id: serverId } })).iconKey,
      async (old) =>
        (await this.prisma.server.updateMany({ where: { id: serverId, iconKey: old }, data: { iconKey: name } })).count,
    );
    const server = await this.prisma.server.findUniqueOrThrow({ where: { id: serverId } });
    if (prev && AVATAR_NAME.test(prev)) await this.storage.remove(`server-icons/${prev}`).catch(() => undefined);
    this.realtime.emit(rooms.server(serverId), 'server:updated', serverSummary(server));
    return server;
  }

  /** Valida (tipo pelos bytes, tamanho, dimensões) e grava em `<pasta>/<nome aleatório>`; devolve o nome. */
  private async storeImage(
    file: AsyncIterable<Buffer> & { truncated?: boolean },
    folder: string,
    limits: { maxBytes: number; maxSide: number; label: string } = AVATAR_LIMITS,
  ) {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of file) {
      size += c.length;
      if (size > limits.maxBytes) throw new PayloadTooLargeException(`a imagem passa de ${limits.label}`);
      chunks.push(c);
    }
    if (file.truncated) throw new PayloadTooLargeException(`a imagem passa de ${limits.label}`);
    if (!size) throw new BadRequestException('arquivo vazio');
    const buf = Buffer.concat(chunks);
    // tipo real pelos bytes; o declarado pelo cliente não vale
    const { fileTypeFromBuffer } = await import('file-type');
    const mime = (await fileTypeFromBuffer(buf))?.mime;
    const ext = mime ? TYPES[mime] : undefined;
    if (!mime || !ext) throw new BadRequestException('use uma imagem PNG, JPEG, WebP ou GIF');
    const dims = imageSize(buf, mime);
    if (!dims || dims.width < 16 || dims.height < 16 || dims.width > limits.maxSide || dims.height > limits.maxSide)
      throw new BadRequestException(`a imagem precisa ter entre 16 e ${limits.maxSide} pixels de lado`);
    const name = `${randomUUID()}-${ext}`;
    try {
      await this.storage.write(`${folder}/${name}`, buf, mime);
    } catch (e) {
      // ex.: pasta do volume sem permissão de escrita, ou bucket/credenciais do S3 incorretos
      this.log.error(`gravar ${folder}/${name}: ${e instanceof Error ? e.message : String(e)}`);
      // só o código do sistema (ex.: EACCES), sem caminhos: permite diagnosticar pelo app
      const code =
        e instanceof Error && 'code' in e && typeof e.code === 'string'
          ? ` (${e.code})`
          : e instanceof Error && e.name !== 'Error'
            ? ` (${e.name})`
            : '';
      throw new InternalServerErrorException(`não foi possível salvar a imagem no armazenamento do servidor${code}`);
    }
    return name;
  }

  async clear(userId: string) {
    return this.apply(userId, null);
  }

  /** foto enviada (`name`) ou nenhuma (null) */
  private apply(userId: string, name: string | null) {
    return this.setCurrent(userId, name ? `key:${name}` : null);
  }

  /** Foto por GIF do KLIPY (ADR-0048): a URL como veio, sem guardar cópia. */
  setUrl(userId: string, url: string | null) {
    return this.setCurrent(userId, url ? `url:${url}` : null);
  }

  /** Voltar a usar uma das fotos recentes. */
  async useRecent(userId: string, entry: string) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { recentAvatars: true } });
    if (!u.recentAvatars.includes(entry)) throw new BadRequestException('essa foto não está entre as recentes');
    return this.setCurrent(userId, entry);
  }

  /** Últimas fotos usadas, mais recente primeiro: caminho relativo (enviada) ou URL do KLIPY. */
  async recent(userId: string) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { recentAvatars: true } });
    return u.recentAvatars.map((entry) => ({
      entry,
      url: entry.startsWith('key:') ? `/avatars/${entry.slice(4)}` : entry.slice(4),
    }));
  }

  /**
   * Troca a foto atual por `next` ("key:<nome>", "url:<https>" ou null). A anterior vai para as recentes (até 6); a
   * que sai das recentes e era enviada tem o arquivo apagado. Atômico contra duas trocas ao mesmo tempo.
   */
  private async setCurrent(userId: string, next: string | null) {
    for (let i = 0; i < 5; i++) {
      const u = await this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { avatarKey: true, avatarUrl: true, recentAvatars: true },
      });
      const current = u.avatarKey ? `key:${u.avatarKey}` : u.avatarUrl ? `url:${u.avatarUrl}` : null;
      const recent = [...(current && current !== next ? [current] : []), ...u.recentAvatars]
        .filter((e, j, a) => e !== next && a.indexOf(e) === j)
        .slice(0, RECENT_AVATARS);
      const done = await this.prisma.user.updateMany({
        where: { id: userId, avatarKey: u.avatarKey, avatarUrl: u.avatarUrl },
        data: {
          avatarKey: next?.startsWith('key:') ? next.slice(4) : null,
          avatarUrl: next?.startsWith('url:') ? next.slice(4) : null,
          recentAvatars: recent,
        },
      });
      if (done.count !== 1) continue;
      // arquivos que saíram de tudo (nem atual nem recente)
      const kept = new Set([next, ...recent]);
      for (const e of [current, ...u.recentAvatars])
        if (e?.startsWith('key:') && !kept.has(e) && AVATAR_NAME.test(e.slice(4)))
          await this.storage.remove(`avatars/${e.slice(4)}`).catch(() => undefined);
      await this.announce(userId);
      return this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    }
    throw new ConflictException('a foto foi alterada ao mesmo tempo; tente de novo');
  }

  /** Exclusão da conta (ADR-0039): apaga foto, fotos recentes e banner (arquivos inclusos), sem guardar nada. */
  async purge(userId: string) {
    const u = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { avatarKey: true, recentAvatars: true, bannerKey: true },
    });
    await this.prisma.user.update({
      where: { id: userId },
      data: { avatarKey: null, avatarUrl: null, recentAvatars: [], bannerKey: null, bannerUrl: null },
    });
    const keys = [u.avatarKey, ...u.recentAvatars.filter((e) => e.startsWith('key:')).map((e) => e.slice(4))];
    for (const k of keys)
      if (k && AVATAR_NAME.test(k)) await this.storage.remove(`avatars/${k}`).catch(() => undefined);
    if (u.bannerKey && AVATAR_NAME.test(u.bannerKey))
      await this.storage.remove(`banners/${u.bannerKey}`).catch(() => undefined);
    await this.announce(userId);
  }

  /** Banner do perfil (ADR-0048): enviado (até 4 MB, GIF animado vale) ou GIF do KLIPY; um tira o outro. */
  async setBanner(userId: string, file: AsyncIterable<Buffer> & { truncated?: boolean }) {
    const name = await this.storeImage(file, 'banners', BANNER_LIMITS);
    return this.applyBanner(userId, { bannerKey: name, bannerUrl: null });
  }

  setBannerUrl(userId: string, url: string | null) {
    return this.applyBanner(userId, { bannerKey: null, bannerUrl: url });
  }

  private async applyBanner(userId: string, data: { bannerKey: string | null; bannerUrl: string | null }) {
    const prev = await swapKey(
      async () => (await this.prisma.user.findUniqueOrThrow({ where: { id: userId } })).bannerKey,
      async (old) => (await this.prisma.user.updateMany({ where: { id: userId, bannerKey: old }, data })).count,
    );
    if (prev && AVATAR_NAME.test(prev)) await this.storage.remove(`banners/${prev}`).catch(() => undefined);
    return this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
  }

  /** Perfil público mudou: avisa a própria pessoa (outras sessões) e quem compartilha servidor com ela. */
  async announce(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const servers = await this.prisma.serverMember.findMany({ where: { userId }, select: { serverId: true } });
    this.realtime.emit(
      [rooms.user(userId), ...servers.map((s) => rooms.server(s.serverId))],
      'user:updated',
      userPublic(user),
    );
  }

  /** Imagem de insígnia (ADR-0043): mesmas regras da foto de perfil; devolve o nome (badges/<nome>). */
  storeBadgeImage(file: AsyncIterable<Buffer> & { truncated?: boolean }) {
    return this.storeImage(file, 'badges');
  }

  storeEmojiImage(file: AsyncIterable<Buffer> & { truncated?: boolean }) {
    return this.storeImage(file, 'emojis', EMOJI_LIMITS);
  }

  async removeEmojiImage(name: string) {
    if (AVATAR_NAME.test(name)) await this.storage.remove(`emojis/${name}`).catch(() => undefined);
  }

  async removeBadgeImage(name: string | null) {
    if (name && AVATAR_NAME.test(name)) await this.storage.remove(`badges/${name}`).catch(() => undefined);
  }

  /** Para GET /avatars/:name, /server-icons/:name, /wallpapers/:name e /badge-images/:name. */
  open(
    name: string,
    folder:
      | 'avatars'
      | 'server-icons'
      | 'wallpapers'
      | 'badges'
      | 'banners'
      | 'server-banners'
      | 'invite-backgrounds'
      | 'emojis' = 'avatars',
  ) {
    const m = AVATAR_NAME.exec(name);
    if (!m) return null;
    const mime = Object.entries(TYPES).find(([, e]) => e === m[1])![0];
    return { mime, key: `${folder}/${name}` };
  }
}
