/**
 * Comandos de contexto dos bots (ADR-0034): `type: 'user'` e `type: 'message'` aparecem no submenu "Apps" do menu
 * de uma pessoa ou de uma mensagem. Funções puras (testadas em test/apps.test.ts).
 */
import type { ServerCommands } from '@opencord/contracts';
import { flattenCommands, type SlashCommandRef } from './slash';

export interface UserCommandBody {
  type: 'user_command';
  channelId: string;
  botId: string;
  command: string;
  targetUserId: string;
}

export interface MessageCommandBody {
  type: 'message_command';
  botId: string;
  command: string;
  messageId: string;
}

/** comandos de contexto do tipo pedido que a pessoa pode usar (respeita `defaultMemberPermissions`) */
export function contextCommands(
  list: readonly ServerCommands[] | undefined,
  type: 'user' | 'message',
  myPermissions: number | undefined,
  owner = false,
): SlashCommandRef[] {
  return flattenCommands(list, { type, myPermissions, owner });
}

export function userCommandBody(ref: SlashCommandRef, channelId: string, targetUserId: string): UserCommandBody {
  return { type: 'user_command', channelId, botId: ref.botId, command: ref.command.name, targetUserId };
}

export function messageCommandBody(ref: SlashCommandRef, messageId: string): MessageCommandBody {
  return { type: 'message_command', botId: ref.botId, command: ref.command.name, messageId };
}
