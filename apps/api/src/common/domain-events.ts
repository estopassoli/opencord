import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';

/** Eventos internos para desacoplar módulos (ex.: servidores → voz) sem dependência circular. */
export type DomainEvent =
  | { type: 'member.removed'; serverId: string; userId: string; reason: 'kicked' | 'left' | 'deleted' }
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
