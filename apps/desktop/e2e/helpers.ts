import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const API = process.env.OPENCORD_API ?? 'http://localhost:3000';
export const OWNER = {
  email: process.env.OPENCORD_EMAIL ?? 'owner@opencord.local',
  password: process.env.OPENCORD_PASSWORD ?? 'dev-only-owner-password',
};
export const shot = (n: string) => path.join(__dirname, 'results', `${n}.png`);
export const TONE = path.join(__dirname, 'results', 'tone.wav');
// --mute-audio: o processo não reproduz nada nos alto-falantes; o WAV só alimenta o microfone falso.
export const FLAGS = [
  '--use-fake-device-for-media-stream',
  '--use-fake-ui-for-media-stream',
  '--mute-audio',
  `--use-file-for-fake-audio-capture=${TONE}`,
];

/** WAV PCM 16-bit mono 48 kHz: tom de 440 Hz contínuo (fala sintética para o microfone falso). */
export function writeTone(file: string, seconds = 5) {
  const rate = 48000;
  const n = rate * seconds;
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + n * 2, 4);
  b.write('WAVE', 8);
  b.write('fmt ', 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 12000), 44 + i * 2);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, b);
}

export async function json<T>(method: string, url: string, body?: unknown, token?: string): Promise<T> {
  const r = await fetch(`${API}${url}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!r.ok) throw new Error(`${method} ${url} → ${r.status} ${await r.text()}`);
  return (r.status === 204 ? undefined : await r.json()) as T;
}

export async function launch(
  profile: string,
  flags: string[] = FLAGS,
): Promise<{ app: ElectronApplication; page: Page }> {
  const dir = path.join(__dirname, 'results', profile);
  rmSync(dir, { recursive: true, force: true });
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${dir}`, ...flags],
    cwd: path.join(__dirname, '..'),
  });
  return { app, page: await app.firstWindow() };
}

/** Login de conta (apelido ou e-mail + senha): tela padrão de entrada. */
export async function login(page: Page, email: string, password: string) {
  await page.getByLabel('Apelido ou e-mail').fill(email);
  await page.getByLabel('Senha').fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Servidores' })).toBeVisible({ timeout: 15_000 });
}

/** Entrada só com apelido, pelo link "Utilizar apenas apelido" (ADR-0007). */
export async function joinWithNickname(page: Page, nickname: string) {
  await page.getByRole('button', { name: /^Utilizar apenas apelido/ }).click();
  await page.getByLabel('Apelido').fill(nickname);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Servidores' })).toBeVisible({ timeout: 15_000 });
}

export const uniqueNick = (prefix: string) => `${prefix} ${Date.now().toString(36).slice(-5)}`;

/** Cria um usuário de teste via convite de uso único e retorna credenciais. */
export async function createTestUser(ownerToken: string, serverId: string, displayName: string) {
  const inv = await json<{ code: string }>(
    'POST',
    `/servers/${serverId}/invites`,
    { maxUses: 1, expiresInSeconds: 600 },
    ownerToken,
  );
  const username = `e2e_${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
  const reg = await json<{ user: { id: string } }>('POST', '/auth/register', {
    inviteCode: inv.code,
    email: `${username}@e2e.local`,
    username,
    displayName,
    password: 'e2e-password-123',
  });
  return { email: `${username}@e2e.local`, password: 'e2e-password-123', id: reg.user.id, username };
}

export async function ownerSession() {
  const owner = await json<{ tokens: { accessToken: string } }>('POST', '/auth/login', {
    login: OWNER.email,
    password: OWNER.password,
  });
  const servers = await json<{ id: string; name: string }[]>('GET', '/servers', undefined, owner.tokens.accessToken);
  const server = servers.find((x) => x.name === 'OpenCord') ?? servers[0];
  if (!server) throw new Error('nenhum servidor');
  return { ownerToken: owner.tokens.accessToken, serverId: server.id };
}

export async function joinVoice(page: Page) {
  await page.getByRole('button', { name: 'OpenCord' }).first().click();
  await page.getByRole('button', { name: 'Sala' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Voz conectada' })).toBeVisible({ timeout: 25_000 });
}

export type App = { app: ElectronApplication; page: Page };
