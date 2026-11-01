/**
 * Ponte com o Slack (ADR-0033): canais espelhados nos dois sentidos. Um app do Slack por instância (variáveis de
 * ambiente); aqui só o mapeamento canal ↔ canal, o envio (chat.postMessage com o nome de quem escreveu) e a entrada
 * (Events API assinada → usuário fantoche `slack-<id>` → postAsWebhook).
 */
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import {
  MENTION_RE,
  Permission,
  type Message,
  type SlackChannel,
  type SlackLink,
  type SlackStatus,
} from '@opencord/contracts';
import type { Prisma } from '@opencord/db';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Subscription } from 'rxjs';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { DomainEvents } from '../common/domain-events.js';
import { notFound } from '../common/errors.js';
import { PrismaService } from '../common/prisma.service.js';
import { MessagesService } from '../messages/messages.service.js';
import { PermissionsService } from '../servers/permissions.service.js';

type LinkRow = Prisma.SlackLinkGetPayload<Record<string, never>>;

interface SlackUser {
  name: string;
  at: number;
}
/** evento `message` do Slack (só os campos usados) */
interface SlackMessageEvent {
  type?: string;
  subtype?: string;
  bot_id?: string;
  user?: string;
  channel?: string;
  text?: string;
  ts?: string;
  files?: { name?: string; permalink?: string }[];
}

const USER_CACHE_MS = 10 * 60_000;
const CHANNELS_CACHE_MS = 60_000;
const SIGNATURE_WINDOW_S = 5 * 60;
const SEEN_EVENTS_MAX = 1000;

@Injectable()
export class SlackService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Slack');
  private sub: Subscription | null = null;
  private readonly users = new Map<string, SlackUser>();
  private channelsCache: { at: number; list: SlackChannel[] } | null = null;
  private team: string | null = null;
  /** event_id já tratados (o Slack reenvia quando a resposta demora) */
  private readonly seen = new Set<string>();

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly prisma: PrismaService,
    private readonly perms: PermissionsService,
    private readonly messages: MessagesService,
    private readonly events: DomainEvents,
  ) {}

  onModuleInit() {
    if (!this.configured()) return;
    this.sub = this.events.stream.subscribe((e) => {
      if (e.type === 'message.created')
        void this.outbound(e.message).catch((err: unknown) => this.log.warn(`enviar: ${String(err)}`));
    });
  }

  onModuleDestroy() {
    this.sub?.unsubscribe();
  }

  configured(): boolean {
    return Boolean(this.cfg.SLACK_BOT_TOKEN && this.cfg.SLACK_SIGNING_SECRET);
  }

  // ---------- Web API do Slack ----------
  private async api<T extends { ok: boolean; error?: string }>(method: string, body: Record<string, unknown> = {}) {
    const res = await fetch(`${this.cfg.SLACK_API_URL.replace(/\/$/, '')}/${method}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=utf-8',
        authorization: `Bearer ${this.cfg.SLACK_BOT_TOKEN}`,
      },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as T;
    if (!json.ok) throw new Error(`Slack ${method}: ${json.error ?? res.status}`);
    return json;
  }

  async status(): Promise<SlackStatus> {
    if (!this.configured()) return { configured: false, team: null };
    if (this.team === null) {
      try {
        const r = await this.api<{ ok: boolean; team?: string }>('auth.test');
        this.team = r.team ?? '';
      } catch (e) {
        this.log.warn(`auth.test: ${String(e)}`);
        return { configured: true, team: null };
      }
    }
    return { configured: true, team: this.team || null };
  }

  /** canais públicos que o app enxerga (cache de 1 min) */
  async channels(): Promise<SlackChannel[]> {
    if (!this.configured()) throw new NotFoundException('Slack não configurado nesta instância');
    if (this.channelsCache && Date.now() - this.channelsCache.at < CHANNELS_CACHE_MS) return this.channelsCache.list;
    const list: SlackChannel[] = [];
    let cursor: string | undefined;
    do {
      const r = await this.api<{
        ok: boolean;
        channels?: { id: string; name: string; is_archived?: boolean }[];
        response_metadata?: { next_cursor?: string };
      }>('conversations.list', { types: 'public_channel', exclude_archived: true, limit: 200, cursor });
      for (const c of r.channels ?? []) if (!c.is_archived) list.push({ id: c.id, name: c.name });
      cursor = r.response_metadata?.next_cursor || undefined;
    } while (cursor && list.length < 1000);
    list.sort((a, b) => a.name.localeCompare(b.name));
    this.channelsCache = { at: Date.now(), list };
    return list;
  }

  private async userName(slackUserId: string): Promise<string> {
    const hit = this.users.get(slackUserId);
    if (hit && Date.now() - hit.at < USER_CACHE_MS) return hit.name;
    let name = slackUserId;
    try {
      const r = await this.api<{
        ok: boolean;
        user?: { real_name?: string; name?: string; profile?: { display_name?: string; real_name?: string } };
      }>('users.info', { user: slackUserId });
      name = r.user?.profile?.display_name || r.user?.real_name || r.user?.profile?.real_name || r.user?.name || name;
    } catch (e) {
      this.log.warn(`users.info ${slackUserId}: ${String(e)}`);
    }
    this.users.set(slackUserId, { name, at: Date.now() });
    return name;
  }

  // ---------- ligações ----------
  private serialize(l: LinkRow): SlackLink {
    return {
      id: l.id,
      serverId: l.serverId,
      channelId: l.channelId,
      slackChannelId: l.slackChannelId,
      slackChannelName: l.slackChannelName,
      createdAt: l.createdAt.toISOString(),
    };
  }

  async list(userId: string, serverId: string): Promise<SlackLink[]> {
    await this.perms.requireServer(serverId, userId, Permission.MANAGE_SERVER);
    const rows = await this.prisma.slackLink.findMany({ where: { serverId }, orderBy: { createdAt: 'asc' } });
    return rows.map((l) => this.serialize(l));
  }

  async create(
    userId: string,
    serverId: string,
    dto: { channelId: string; slackChannelId: string },
  ): Promise<SlackLink> {
    await this.perms.requireServer(serverId, userId, Permission.MANAGE_SERVER);
    if (!this.configured()) throw new BadRequestException('Slack não configurado nesta instância');
    const ch = await this.prisma.channel.findUnique({
      where: { id: dto.channelId },
      select: { serverId: true, kind: true },
    });
    if (!ch || ch.serverId !== serverId || ch.kind !== 'text')
      throw new BadRequestException('escolha um canal de texto deste servidor');
    const slack = (await this.channels()).find((c) => c.id === dto.slackChannelId);
    if (!slack) throw new BadRequestException('canal do Slack não encontrado (o app precisa enxergá-lo)');
    const taken = await this.prisma.slackLink.findFirst({
      where: { OR: [{ channelId: dto.channelId }, { slackChannelId: dto.slackChannelId }] },
      select: { id: true },
    });
    if (taken) throw new BadRequestException('um dos canais já está ligado');
    // entrar no canal do Slack para receber e enviar; se falhar (privado), quem administra convida o app por lá
    await this.api('conversations.join', { channel: dto.slackChannelId }).catch((e: unknown) =>
      this.log.warn(`conversations.join: ${String(e)}`),
    );
    const row = await this.prisma.slackLink.create({
      data: {
        serverId,
        channelId: dto.channelId,
        slackChannelId: dto.slackChannelId,
        slackChannelName: slack.name,
        createdById: userId,
      },
    });
    return this.serialize(row);
  }

  async remove(userId: string, linkId: string) {
    const l = await this.prisma.slackLink.findUnique({ where: { id: linkId } });
    if (!l) throw notFound('ligação');
    await this.perms.requireServer(l.serverId, userId, Permission.MANAGE_SERVER).catch(() => {
      throw notFound('ligação');
    });
    await this.prisma.slackLink.delete({ where: { id: linkId } });
  }

  // ---------- OpenCord → Slack ----------
  private async outbound(m: Message) {
    if (!m.channelId) return;
    // o que veio do Slack não volta (autor fantoche)
    if (m.author.username.startsWith('slack-')) return;
    const link = await this.prisma.slackLink.findUnique({ where: { channelId: m.channelId } });
    if (!link) return;
    let text = m.body;
    const ids = [...text.matchAll(MENTION_RE)].map((x) => (x[1] as string).toLowerCase());
    if (ids.length) {
      const users = await this.prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, displayName: true },
      });
      const names = new Map(users.map((u) => [u.id, u.displayName]));
      text = text.replace(MENTION_RE, (_s, id: string) => `@${names.get(id.toLowerCase()) ?? 'alguém'}`);
    }
    for (const a of m.attachments) text += `\n<${a.url}|${a.originalName}>`;
    if (!text.trim()) return;
    await this.api('chat.postMessage', {
      channel: link.slackChannelId,
      text: text.slice(0, 4000),
      username: m.author.displayName,
      unfurl_links: false,
      unfurl_media: false,
    });
  }

  // ---------- Slack → OpenCord ----------
  /** assinatura `v0=` (HMAC-SHA256 de `v0:<ts>:<corpo>`), janela de 5 min, comparação em tempo constante */
  verify(headers: { signature?: string; timestamp?: string }, rawBody: string): boolean {
    const secret = this.cfg.SLACK_SIGNING_SECRET;
    if (!secret || !headers.signature || !headers.timestamp) return false;
    const ts = Number(headers.timestamp);
    if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > SIGNATURE_WINDOW_S) return false;
    const expected = Buffer.from(
      `v0=${createHmac('sha256', secret).update(`v0:${headers.timestamp}:${rawBody}`).digest('hex')}`,
    );
    const given = Buffer.from(headers.signature);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  /** Devolve o que responder ao Slack; o trabalho pesado fica para depois da resposta. */
  handleEvent(payload: Record<string, unknown>): Record<string, unknown> {
    if (payload['type'] === 'url_verification') return { challenge: payload['challenge'] };
    if (payload['type'] !== 'event_callback') return { ok: true };
    const eventId = typeof payload['event_id'] === 'string' ? payload['event_id'] : null;
    if (eventId) {
      if (this.seen.has(eventId)) return { ok: true };
      this.seen.add(eventId);
      if (this.seen.size > SEEN_EVENTS_MAX) this.seen.delete(this.seen.values().next().value as string);
    }
    const event = payload['event'] as SlackMessageEvent | undefined;
    if (event) void this.inbound(event).catch((e: unknown) => this.log.warn(`receber: ${String(e)}`));
    return { ok: true };
  }

  private async inbound(e: SlackMessageEvent) {
    if (e.type !== 'message' || e.bot_id || !e.user || !e.channel) return;
    if (e.subtype && e.subtype !== 'file_share') return;
    const link = await this.prisma.slackLink.findUnique({ where: { slackChannelId: e.channel } });
    if (!link) return;
    let text = await this.decodeText(e.text ?? '');
    for (const f of e.files ?? []) if (f.permalink) text += `\n${f.permalink}`;
    text = text.trim();
    if (!text) return;
    const puppet = await this.puppet(e.user);
    await this.messages.postAsWebhook({ userId: puppet, channelId: link.channelId, serverId: link.serverId }, text);
  }

  /** mrkdwn do Slack → texto: menções `<@U…>` viram @nome, links `<url|rótulo>` viram "rótulo (url)", entidades HTML */
  private async decodeText(text: string): Promise<string> {
    const mentions = [...text.matchAll(/<@([A-Z0-9]+)(?:\|[^>]*)?>/g)].map((m) => m[1] as string);
    const names = new Map<string, string>();
    for (const id of new Set(mentions)) names.set(id, await this.userName(id));
    return text
      .replace(/<@([A-Z0-9]+)(?:\|[^>]*)?>/g, (_s, id: string) => `@${names.get(id) ?? id}`)
      .replace(/<#[A-Z0-9]+\|([^>]*)>/g, '#$1')
      .replace(/<!(channel|here|everyone)>/g, '@$1')
      .replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, '$2 ($1)')
      .replace(/<(https?:\/\/[^>]+)>/g, '$1')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
  }

  /** usuário fantoche de uma pessoa do Slack (selo APP, sem login); o nome acompanha o perfil no Slack */
  private async puppet(slackUserId: string): Promise<string> {
    const username = `slack-${slackUserId.toLowerCase()}`;
    const name = (await this.userName(slackUserId)).slice(0, 64);
    const u = await this.prisma.user.upsert({
      where: { username },
      create: { username, displayName: name, isWebhook: true },
      update: { displayName: name },
      select: { id: true },
    });
    return u.id;
  }
}
