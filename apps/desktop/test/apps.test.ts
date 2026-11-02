import { Permission, type BotCommand, type ServerCommands } from '@opencord/contracts';
import { describe, expect, it } from 'vitest';
import { contextCommands, messageCommandBody, userCommandBody } from '../src/lib/apps';

const bot = { id: 'b1', username: 'mod_bot', displayName: 'Mod', avatarKey: null, bot: true };
const cmd = (c: Partial<BotCommand> & Pick<BotCommand, 'name' | 'type'>): BotCommand => ({
  description: '',
  options: [],
  defaultMemberPermissions: null,
  guildIds: [],
  ...c,
});
const server: ServerCommands[] = [
  {
    botId: 'b1',
    bot,
    commands: [
      cmd({ name: 'ping', type: 'chat', description: 'Pong' }),
      cmd({ name: 'Ver perfil', type: 'user' }),
      cmd({ name: 'Advertir', type: 'user', defaultMemberPermissions: Permission.MODERATE_MEMBERS }),
      cmd({ name: 'Reportar', type: 'message' }),
    ],
  },
];

describe('apps: comandos de contexto', () => {
  it('separa por tipo e respeita defaultMemberPermissions', () => {
    expect(contextCommands(server, 'user', Permission.SEND_MESSAGES).map((c) => c.command.name)).toEqual([
      'Ver perfil',
    ]);
    expect(contextCommands(server, 'user', Permission.MODERATE_MEMBERS).map((c) => c.command.name)).toEqual([
      'Ver perfil',
      'Advertir',
    ]);
    expect(contextCommands(server, 'user', 0, true).map((c) => c.command.name)).toEqual(['Ver perfil', 'Advertir']);
    expect(contextCommands(server, 'message', 0).map((c) => c.command.name)).toEqual(['Reportar']);
    expect(contextCommands(undefined, 'message', 0)).toEqual([]);
  });
  it('monta os corpos de POST /interactions', () => {
    const [user] = contextCommands(server, 'user', 0);
    const [msg] = contextCommands(server, 'message', 0);
    expect(userCommandBody(user!, 'c1', 'u2')).toEqual({
      type: 'user_command',
      channelId: 'c1',
      botId: 'b1',
      command: 'Ver perfil',
      targetUserId: 'u2',
    });
    expect(messageCommandBody(msg!, 'm1')).toEqual({
      type: 'message_command',
      botId: 'b1',
      command: 'Reportar',
      messageId: 'm1',
    });
  });
});
