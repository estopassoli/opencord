/** Foto de perfil: envio validado pelos bytes, rota pública com cache, troca apaga a antiga, aviso em tempo real. */
import { crc32, deflateSync } from 'node:zlib';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Me, UserPublic } from '@opencord/contracts';
import type { Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TEST_API_PORT } from './env.js';
import { bootstrapOwner, connectSocket, Http, nextEvent, prisma, register, resetDb, startApp } from './helpers.js';

let app: NestFastifyApplication;
let http: Http;
const base = `http://127.0.0.1:${TEST_API_PORT}`;
const sockets: Socket[] = [];

beforeAll(async () => {
  app = await startApp();
  http = new Http(app);
});
afterAll(async () => app.close());
beforeEach(resetDb);
afterEach(() => {
  for (const s of sockets.splice(0)) s.disconnect();
});

/** PNG RGB w×h de uma cor (válido: assinatura, IHDR, IDAT, IEND com CRC). */
function png(w: number, h: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bits
  ihdr[9] = 2; // RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 0x80)]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function send(token: string, data: Buffer, name = 'foto.png', mime = 'image/png') {
  const form = new FormData();
  form.append('file', new Blob([data], { type: mime }), name);
  const res = await fetch(`${base}/me/avatar`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  return { status: res.status, body: (await res.json()) as Me & { message?: string } };
}

describe('foto de perfil', () => {
  it('envia, serve com cache público, troca apagando a anterior e avisa quem divide servidor', async () => {
    const { owner } = await bootstrapOwner(http);
    const alice = await register(http);
    const sa = await connectSocket(alice.token);
    sockets.push(sa);
    const updated = nextEvent<UserPublic>(sa, 'user:updated', (u) => u.id === owner.id && u.avatarKey !== null);
    const r = await send(owner.token, png(64, 64));
    expect(r.status).toBe(201);
    const key = r.body.avatarKey!;
    expect(key).toMatch(/^[0-9a-f-]{36}-png$/);
    expect((await updated).avatarKey).toBe(key);

    const img = await fetch(`${base}/avatars/${key}`);
    expect(img.status).toBe(200);
    expect(img.headers.get('content-type')).toBe('image/png');
    expect(img.headers.get('cache-control')).toContain('immutable');
    expect(
      Buffer.from(await img.arrayBuffer())
        .subarray(0, 4)
        .toString('hex'),
    ).toBe('89504e47');

    // membros veem a foto no servidor
    const servers = await http.req<{ id: string }[]>('GET', '/servers', { token: alice.token });
    const d = await http.req<{ members: { user: UserPublic }[] }>('GET', `/servers/${servers.body[0]!.id}`, {
      token: alice.token,
    });
    expect(d.body.members.find((m) => m.user.id === owner.id)?.user.avatarKey).toBe(key);

    // trocar: a antiga deixa de existir
    const r2 = await send(owner.token, png(32, 32));
    expect(r2.body.avatarKey).not.toBe(key);
    expect((await fetch(`${base}/avatars/${key}`)).status).toBe(404);

    // remover
    const del = await http.req<Me>('DELETE', '/me/avatar', { token: owner.token });
    expect(del.body.avatarKey).toBeNull();
    expect((await fetch(`${base}/avatars/${r2.body.avatarKey}`)).status).toBe(404);
  });

  it('recusa o que não é imagem (mesmo com MIME de imagem), imagens minúsculas e nomes fora do padrão', async () => {
    const { owner } = await bootstrapOwner(http);
    const fake = await send(owner.token, Buffer.from('<svg onload=alert(1)></svg>'), 'x.png', 'image/png');
    expect(fake.status).toBe(400);
    const tiny = await send(owner.token, png(4, 4));
    expect(tiny.status).toBe(400);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).avatarKey).toBeNull();
    expect((await fetch(`${base}/avatars/..%2F..%2Fetc-png`)).status).toBe(404);
    expect((await fetch(`${base}/avatars/qualquer`)).status).toBe(404);
  });

  it('imagem do servidor: dono envia, membros recebem server:updated, membro comum não pode', async () => {
    const { owner, serverId } = await bootstrapOwner(http);
    const alice = await register(http);
    const sa = await connectSocket(alice.token);
    sockets.push(sa);
    const sendIcon = async (token: string, data: Buffer) => {
      const form = new FormData();
      form.append('file', new Blob([data], { type: 'image/png' }), 'icone.png');
      const res = await fetch(`${base}/servers/${serverId}/icon`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: form,
      });
      return { status: res.status, body: (await res.json()) as { iconKey: string | null } };
    };
    expect((await sendIcon(alice.token, png(64, 64))).status).toBe(403);
    const updated = nextEvent<{ id: string; iconKey: string | null }>(sa, 'server:updated', (s) => s.id === serverId);
    const r = await sendIcon(owner.token, png(128, 128));
    expect(r.status).toBe(201);
    expect(r.body.iconKey).toMatch(/^[0-9a-f-]{36}-png$/);
    expect((await updated).iconKey).toBe(r.body.iconKey);
    const img = await fetch(`${base}/server-icons/${r.body.iconKey}`);
    expect(img.status).toBe(200);
    expect(img.headers.get('content-type')).toBe('image/png');
    // a rota de avatares não serve ícones de servidor (pastas separadas)
    expect((await fetch(`${base}/avatars/${r.body.iconKey}`)).status).toBe(404);
    const del = await http.req<{ iconKey: string | null }>('DELETE', `/servers/${serverId}/icon`, {
      token: owner.token,
    });
    expect(del.body.iconKey).toBeNull();
    expect((await fetch(`${base}/server-icons/${r.body.iconKey}`)).status).toBe(404);
  });

  it('apelido trocado também chega em tempo real', async () => {
    const { owner } = await bootstrapOwner(http);
    const alice = await register(http);
    const sa = await connectSocket(alice.token);
    sockets.push(sa);
    const got = nextEvent<UserPublic>(sa, 'user:updated', (u) => u.id === owner.id);
    await http.req('PATCH', '/me', { token: owner.token, body: { displayName: 'Dono Novo' } });
    expect((await got).displayName).toBe('Dono Novo');
  });
});
