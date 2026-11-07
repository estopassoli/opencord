/** Troca do @: uma vez a cada 30 dias, sem repetir o de outra pessoa nem usar nomes reservados. */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Me } from '@opencord/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Http, prisma, register, resetDb, startApp } from './helpers.js';

let app: NestFastifyApplication;
let http: Http;

beforeAll(async () => {
  app = await startApp();
  http = new Http(app);
});
afterAll(async () => app.close());
beforeEach(resetDb);

const patch = (token: string, body: Record<string, unknown>) =>
  http.req<Me & { message?: string }>('PATCH', '/me', { token, body });

describe('trocar o @', () => {
  it('troca uma vez, recusa de novo antes de 30 dias e libera depois', async () => {
    const a = await register(http);
    const b = await register(http);
    expect(a.auth.user.usernameChangeAvailableAt).toBeNull();

    // reservado e em uso: 400/409, sem gastar a troca
    expect((await patch(a.token, { username: 'opencord_oficial' })).status).toBe(400);
    expect((await patch(a.token, { username: b.auth.user.username })).status).toBe(409);
    expect((await patch(a.token, { username: 'Maiuscula' })).status).toBe(400);

    const ok = await patch(a.token, { username: 'novo_nome' });
    expect(ok.status).toBe(200);
    expect(ok.body.username).toBe('novo_nome');
    const next = Date.parse(ok.body.usernameChangeAvailableAt ?? '');
    expect(next - Date.now()).toBeGreaterThan(29 * 86_400_000);

    const again = await patch(a.token, { username: 'outro_nome' });
    expect(again.status).toBe(400);
    expect(again.body.message).toMatch(/de novo em/);
    // mandar o mesmo @ junto com o apelido não conta como troca
    expect((await patch(a.token, { username: 'novo_nome', displayName: 'Novo Apelido' })).status).toBe(200);

    // 31 dias depois: pode de novo
    await prisma.user.update({
      where: { id: a.id },
      data: { usernameChangedAt: new Date(Date.now() - 31 * 86_400_000) },
    });
    const later = await patch(a.token, { username: 'outro_nome' });
    expect(later.status).toBe(200);
    expect(later.body.username).toBe('outro_nome');
  });
});
