import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../common/prisma.service.js';
import { MessagesService } from '../messages/messages.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { SocialService } from '../social/social.service.js';
import { SystemUserService } from './system-user.service.js';

/**
 * Avisos da conta OpenCord (ADR-0045) por DM sem resposta: ideia recusada no quadro, login de aparelho novo
 * (ADR-0046)... A DM é a mesma para cada pessoa, criada na primeira vez.
 */
@Injectable()
export class SystemNoticesService {
  constructor(
    private readonly system: SystemUserService,
    private readonly messages: MessagesService,
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly social: SocialService,
  ) {}

  async notify(userId: string, body: string) {
    const systemId = await this.system.ensure();
    const conversationId = await this.dmWith(systemId, userId);
    await this.messages.create(
      systemId,
      { conversationId },
      { requestId: randomUUID(), body },
      { skipModeration: true },
    );
  }

  private async dmWith(systemId: string, userId: string): Promise<string> {
    const [low, high] = systemId < userId ? [systemId, userId] : [userId, systemId];
    const dmKey = `${low}:${high}`;
    const existing = await this.prisma.conversation.findUnique({ where: { dmKey }, select: { id: true } });
    if (existing) return existing.id;
    const c = await this.prisma.conversation.create({
      data: { kind: 'dm', dmKey, members: { create: [{ userId: systemId }, { userId }] } },
      select: { id: true },
    });
    await this.realtime.conversationJoined(c.id, [systemId, userId]);
    await this.social.announceConversation(c.id);
    return c.id;
  }
}
