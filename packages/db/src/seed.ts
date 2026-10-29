/**
 * Seed de desenvolvimento idempotente: proprietário (com conta) e servidor inicial aberto.
 * Pode ser executado várias vezes; não duplica dados. NUNCA rodar em produção com as senhas de exemplo.
 */
import { hash } from '@node-rs/argon2';
import { nickKeyOf } from '@opencord/contracts';
import { createPrismaClient, createServerWithDefaults } from './index.js';

const env = (k: string, d?: string) => {
  const v = process.env[k] ?? d;
  if (!v) throw new Error(`variável ${k} ausente`);
  return v;
};

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('seed de desenvolvimento não roda em produção');
  const prisma = createPrismaClient();
  const email = env('SEED_OWNER_EMAIL', 'owner@opencord.local').toLowerCase();
  const username = env('SEED_OWNER_USERNAME', 'owner');
  const password = env('SEED_OWNER_PASSWORD', 'dev-only-owner-password');

  const owner =
    (await prisma.user.findUnique({ where: { email } })) ??
    (await prisma.user.create({
      data: {
        email,
        username,
        displayName: 'Proprietário',
        nickKey: nickKeyOf('Proprietário'),
        passwordHash: await hash(password, { algorithm: 2 }),
      },
    }));

  let server = await prisma.server.findFirst({ where: { ownerId: owner.id, name: 'OpenCord' } });
  if (!server) server = await prisma.$transaction((tx) => createServerWithDefaults(tx, owner.id, 'OpenCord', { official: true }));

  console.warn(
    JSON.stringify(
      {
        ownerId: owner.id,
        ownerEmail: email,
        serverId: server.id,
      },
      null,
      2,
    ),
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
