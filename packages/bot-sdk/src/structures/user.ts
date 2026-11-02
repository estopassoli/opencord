import type { Conversation, PlayingGame, PresenceStatus, UserProfile, UserPublic } from '@opencord/contracts';
import type { Client } from '../client.js';
import { ActivityType } from '../constants.js';
import { DMChannel } from './channel.js';
import type { Message } from './message.js';
import type { MessagePayload } from './payload.js';

/** O que `client.users.fetch` traz além do público (`GET /users/:id/profile`). */
export interface UserProfileData {
  createdAt: Date;
  friendSince: Date | null;
  mutualServers: UserProfile['mutualServers'];
  mutualFriends: UserPublic[];
}

export class User {
  readonly id: string;
  username: string;
  displayName: string;
  readonly bot: boolean;
  avatarKey: string | null;
  /** super admin da instância (ADR-0013) */
  isInstanceAdmin: boolean;
  /** selo de verificado no perfil */
  verified: boolean;
  /** preenchido por `client.users.fetch(id)` */
  profile: UserProfileData | null = null;

  constructor(
    readonly client: Client,
    data: UserPublic,
  ) {
    this.id = data.id;
    this.username = data.username;
    this.displayName = data.displayName;
    this.bot = data.bot;
    this.avatarKey = data.avatarKey;
    this.isInstanceAdmin = data.isInstanceAdmin ?? false;
    this.verified = data.verified ?? false;
  }

  /** atualiza os campos no lugar (mesma instância nos caches) */
  _patch(data: UserPublic) {
    this.username = data.username;
    this.displayName = data.displayName;
    this.avatarKey = data.avatarKey;
    this.isInstanceAdmin = data.isInstanceAdmin ?? this.isInstanceAdmin;
    this.verified = data.verified ?? this.verified;
    return this;
  }
  _clone(): User {
    const u = Object.create(Object.getPrototypeOf(this) as object) as User;
    return Object.assign(u, this);
  }

  /** não há discriminador: a tag é o próprio nome de usuário */
  get tag() {
    return this.username;
  }
  get globalName() {
    return this.displayName;
  }
  get createdAt() {
    return this.profile?.createdAt ?? null;
  }
  get presence() {
    return this.client.presences.cache.get(this.id) ?? null;
  }
  /** URL do avatar (`GET /avatars/:nome`); null sem avatar */
  avatarURL(): string | null {
    return this.avatarKey ? `${this.client.rest.baseUrl}/avatars/${this.avatarKey}` : null;
  }
  displayAvatarURL(): string | null {
    return this.avatarURL();
  }
  /** menção no formato do OpenCord (`<@id>`) */
  toString() {
    return `<@${this.id}>`;
  }
  equals(other: User | null | undefined) {
    return !!other && other.id === this.id;
  }
  toJSON(): UserPublic {
    return {
      id: this.id,
      username: this.username,
      displayName: this.displayName,
      avatarKey: this.avatarKey,
      bot: this.bot,
      ...(this.isInstanceAdmin ? { isInstanceAdmin: true } : {}),
      ...(this.verified ? { verified: true } : {}),
    };
  }
  /** recarrega o perfil público (`GET /users/:id/profile`) */
  fetch(): Promise<User> {
    return this.client.users.fetch(this.id, { force: true });
  }
  /** abre (ou reaproveita) a conversa direta com a pessoa */
  async createDM(): Promise<DMChannel> {
    const conv = await this.client.rest.post<Conversation>('/conversations', { userIds: [this.id] });
    return new DMChannel(this.client, conv.id, conv);
  }
  async send(payload: MessagePayload): Promise<Message> {
    const dm = await this.createDM();
    return dm.send(payload);
  }
  /** bloquear a pessoa (`PUT /blocks/:id`): ela não consegue mandar DM para o bot */
  async block(): Promise<this> {
    await this.client.rest.put(`/blocks/${this.id}`);
    return this;
  }
  async unblock(): Promise<this> {
    await this.client.rest.delete(`/blocks/${this.id}`);
    return this;
  }
}

/** Usuário de quem só se conhece o id (menção, opção de comando) e que não está no cache. */
export function stubUser(client: Client, id: string): User {
  return new User(client, { id, username: id, displayName: id, avatarKey: null, bot: false });
}

/** O que `setPresence`/`setActivity` aceitam. */
export interface ActivityOptions {
  name: string;
  /** aceito e ignorado: o OpenCord mostra "jogando" */
  type?: number;
  /** quando começou (padrão: agora) */
  startedAt?: Date | number;
  steamAppId?: number;
}
export type ClientPresenceStatus = Exclude<PresenceStatus, 'offline'>;
export interface PresenceData {
  status?: ClientPresenceStatus;
  /** só a primeira vale (um jogo por vez); `[]` limpa */
  activities?: ActivityOptions[];
  /** aceito e ignorado */
  afk?: boolean;
}

/** O usuário do bot (`client.user`): presença, status e texto de status. */
export class ClientUser extends User {
  /**
   * Define status (`online`, `idle`, `dnd`, `invisible`) e/ou a atividade ("jogando X"): `PUT /me/presence` e o
   * comando `presence:game` do gateway. O status também vai em cada heartbeat.
   */
  async setPresence(data: PresenceData): Promise<PresenceData> {
    if (data.status) {
      await this.client.rest.put('/me/presence', { status: data.status });
      this.client.presenceStatus = data.status;
    }
    if (data.activities) {
      const a = data.activities[0];
      const game: PlayingGame | null = a
        ? {
            name: a.name,
            startedAt: a.startedAt ? new Date(a.startedAt).getTime() : Date.now(),
            ...(a.steamAppId ? { steamAppId: a.steamAppId } : {}),
          }
        : null;
      this.client.activity = game;
      await this.client.sendGame(game);
    }
    return data;
  }
  setStatus(status: ClientPresenceStatus) {
    return this.setPresence({ status });
  }
  /** `setActivity('Xadrez')`, `setActivity({ name, type })`; sem argumentos limpa */
  setActivity(activity?: string | ActivityOptions, options: Omit<ActivityOptions, 'name'> = {}) {
    if (activity === undefined) return this.setPresence({ activities: [] });
    const a = typeof activity === 'string' ? { name: activity, type: ActivityType.Playing, ...options } : activity;
    return this.setPresence({ activities: [a] });
  }
  /** status personalizado ("estudando, volto 22h"); `null` limpa (`PUT /me/status-text`) */
  async setStatusText(text: string | null): Promise<string | null> {
    const res = await this.client.rest.put<{ text: string | null }>('/me/status-text', { text });
    return res?.text ?? text;
  }
  /** não há como trocar o nome do bot pelo token: é na tela Aplicativos */
  setUsername(_name: string): never {
    throw new Error('o nome do bot muda na tela Configurações → Aplicativos, não pela API do bot');
  }
}
