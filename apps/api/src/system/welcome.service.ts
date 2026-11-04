import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Subscription } from 'rxjs';
import { DomainEvents } from '../common/domain-events.js';
import { PrismaService } from '../common/prisma.service.js';
import { MessagesService } from '../messages/messages.service.js';
import { SystemUserService } from './system-user.service.js';

/** frases de boas-vindas (uma ao acaso); {u} vira a menção de quem entrou */
export const WELCOME_LINES = [
  'Chegou chegando: boas-vindas, {u}!',
  '{u} entrou no servidor. Puxa uma cadeira!',
  'Olha quem apareceu: {u}! Fica à vontade.',
  'Boas-vindas, {u}! A casa é sua.',
  '{u} acabou de chegar. Alguém dá um oi!',
  'Mais um no grupo: boas-vindas, {u}!',
];

/**
 * Mensagem de boas-vindas (ADR-0050): quando alguém entra num servidor com as boas-vindas ligadas e canal do sistema
 * definido, a conta OpenCord manda uma frase com a menção da pessoa nesse canal.
 */
@Injectable()
export class WelcomeService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Boas-vindas');
  private sub: Subscription | null = null;

  constructor(
    private readonly events: DomainEvents,
    private readonly prisma: PrismaService,
    private readonly messages: MessagesService,
    private readonly system: SystemUserService,
  ) {}

  onModuleInit() {
    this.sub = this.events.stream.subscribe((e) => {
      if (e.type === 'member.joined')
        void this.welcome(e.serverId, e.userId).catch((err: unknown) => this.log.warn(String(err)));
    });
  }

  onModuleDestroy() {
    this.sub?.unsubscribe();
  }

  async welcome(serverId: string, userId: string) {
    const s = await this.prisma.server.findUnique({
      where: { id: serverId },
      select: { welcomeEnabled: true, systemChannelId: true },
    });
    if (!s?.welcomeEnabled || !s.systemChannelId) return;
    const ch = await this.prisma.channel.findUnique({ where: { id: s.systemChannelId }, select: { serverId: true } });
    if (ch?.serverId !== serverId) return;
    const line = WELCOME_LINES[Math.floor(Math.random() * WELCOME_LINES.length)]!;
    await this.messages.create(
      await this.system.ensure(),
      { channelId: s.systemChannelId },
      { requestId: randomUUID(), body: line.replace('{u}', `<@${userId}>`) },
      { skipModeration: true },
    );
  }
}
