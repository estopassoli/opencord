import { Injectable } from '@nestjs/common';
import type { Message } from '@opencord/contracts';
import { Subject } from 'rxjs';

/** Eventos internos para desacoplar módulos (ex.: servidores → voz) sem dependência circular. */
export type DomainEvent =
  | { type: 'member.removed'; serverId: string; userId: string; reason: 'kicked' | 'left' | 'deleted' }
  /** alguém entrou no servidor (convite ou entrada direta): mensagem de boas-vindas (ADR-0050) */
  | { type: 'member.joined'; serverId: string; userId: string }
  /** castigo (ADR-0034) aplicado: a voz da pessoa no servidor é encerrada */
  | { type: 'member.timeout'; serverId: string; userId: string }
  /** mensagem nova num canal de servidor (não em conversa direta); `serverId` do canal (ponte com o Slack) */
  | { type: 'message.created'; serverId: string; message: Message }
  | { type: 'permissions.changed'; serverId: string }
  | { type: 'channel.deleted'; serverId: string; channelId: string }
  | { type: 'user.sessions.revoked'; userId: string };

@Injectable()
export class DomainEvents {
  readonly stream = new Subject<DomainEvent>();
  emit(e: DomainEvent) {
    this.stream.next(e);
  }
}
