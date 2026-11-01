import { describe, expect, it, vi } from 'vitest';
import { REST, Routes, SlashCommandBuilder } from '../src/index.js';

describe('REST + Routes', () => {
  it('put(Routes.applicationCommands) embrulha o array em { commands } e manda o Bearer', async () => {
    const fetchMock = vi.fn(
      async (_input: string, _init?: RequestInit) => new Response('{"commands":[]}', { status: 200 }),
    );
    const rest = new REST({ baseUrl: 'http://api.test', fetch: fetchMock }).setToken('ocb_x');
    await rest.put(Routes.applicationCommands('qualquer-id'), {
      body: [new SlashCommandBuilder().setName('ping').setDescription('Pong')],
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://api.test/bots/@me/commands');
    expect(init?.method).toBe('PUT');
    expect((init?.headers as Record<string, string>).authorization).toBe('Bearer ocb_x');
    expect(JSON.parse(String(init?.body))).toEqual({
      commands: [{ name: 'ping', description: 'Pong', options: [] }],
    });
    expect(Routes.applicationGuildCommands('a', 'b')).toBe('/bots/@me/commands');
  });

  it('sem URL conhecida, falha explicando OPENCORD_URL', () => {
    delete process.env.OPENCORD_URL;
    expect(() => new REST().setToken('x').get('/me')).toThrow(/OPENCORD_URL/);
  });
});
