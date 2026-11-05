/** Configurações do servidor, leva 4 (ADR-0050): emojis personalizados (enviar, limite, nome, imagem pública, reação). */
import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { CustomEmoji, Message, ServerDetail, ServerSummary } from '@opencord/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TEST_API_PORT } from './env.js';
import { bootstrapOwner, Http, outsider, prisma, resetDb, startApp, tinyPng } from './helpers.js';

let app: NestFastifyApplication;
let http: Http;

beforeAll(async () => {
  app = await startApp();
  http = new Http(app);
});
afterAll(async () => app.close());
beforeEach(resetDb);

const upload = (serverId: string, token: string, name: string) => {
  const form = new FormData();
  form.append('file', new Blob([tinyPng(32, 32)], { type: 'image/png' }), 'e.png');
  return fetch(`http://127.0.0.1:${TEST_API_PORT}/servers/${serverId}/emojis?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
};

describe('emojis personalizados', () => {
  it('envia, lista no servidor, serve a imagem, reage, renomeia e apaga', async () => {
    const { owner, serverId } = await bootstrapOwner(http);

    const up = await upload(serverId, owner.token, 'gato_feliz');
    expect(up.status).toBe(201);
    const emoji = (await up.json()) as CustomEmoji;
    expect(emoji).toMatchObject({ name: 'gato_feliz', animated: false });

    // nome inválido e repetido são recusados
    expect((await upload(serverId, owner.token, 'a')).status).toBe(400);
    expect((await upload(serverId, owner.token, 'gato_feliz')).status).toBe(400);

    // vai no resumo do servidor e a imagem é pública
    const d = await http.req<ServerDetail>('GET', `/servers/${serverId}`, { token: owner.token });
    expect(d.body.emojis).toEqual([emoji]);
    const img = await fetch(`http://127.0.0.1:${TEST_API_PORT}/emojis/${emoji.id}`);
    expect(img.status).toBe(200);
    expect(img.headers.get('content-type')).toBe('image/png');

    // membro comum não envia
    const bia = await outsider(http);
    const inv = await http.req<{ code: string }>('POST', `/servers/${serverId}/invites`, { token: owner.token });
    await http.req('POST', `/invites/${inv.body.code}`, { token: bia.token });
    expect((await upload(serverId, bia.token, 'outro')).status).toBe(403);

    // limite de 50 por servidor
    await prisma.serverEmoji.createMany({
      data: Array.from({ length: 49 }, (_, i) => ({ serverId, name: `e${i}x`, imageKey: 'x' })),
    });
    const full = await upload(serverId, owner.token, 'cheio');
    expect(full.status).toBe(400);
    expect(((await full.json()) as { message: string }).message).toMatch(/50 emojis/);

    // reação com o emoji personalizado (token no lugar do emoji)
    const text = d.body.channels.find((c) => c.kind === 'text')!;
    const msg = await http.req<Message>('POST', `/channels/${text.id}/messages`, {
      token: owner.token,
      body: { requestId: randomUUID(), body: `oi <:gato_feliz:${emoji.id}>` },
    });
    const token = `<:gato_feliz:${emoji.id}>`;
    expect(
      (await http.req('PUT', `/messages/${msg.body.id}/reactions/${encodeURIComponent(token)}`, { token: bia.token }))
        .status,
    ).toBe(204);

    // renomear e apagar
    const ren = await http.req<CustomEmoji>('PATCH', `/emojis/${emoji.id}`, {
      token: owner.token,
      body: { name: 'gato' },
    });
    expect(ren.body.name).toBe('gato');
    expect((await http.req('DELETE', `/emojis/${emoji.id}`, { token: bia.token })).status).toBe(403);
    expect((await http.req('DELETE', `/emojis/${emoji.id}`, { token: owner.token })).status).toBe(204);
    const after = await http.req<ServerSummary>('GET', `/servers/${serverId}`, { token: owner.token });
    expect(after.body.emojis?.some((e) => e.id === emoji.id)).toBe(false);
    expect((await fetch(`http://127.0.0.1:${TEST_API_PORT}/emojis/${emoji.id}`)).status).toBe(404);
  });
});
