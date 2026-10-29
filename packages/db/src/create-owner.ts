/**
 * Bootstrap de produção: cria o primeiro proprietário (conta com senha) e um servidor aberto.
 * Uso: DATABASE_URL=... OWNER_EMAIL=... OWNER_USERNAME=... OWNER_PASSWORD=... pnpm --filter @opencord/db create-owner
 * (no container: node dist/create-owner.js). Recusa senha fraca e não sobrescreve usuário existente.
 */
import { hash } from '@node-rs/argon2';
import { nickKeyOf } from '@opencord/contracts';
import { createPrismaClient, createServerWithDefaults } from './index.js';

function need(k: string): string {
  const v = process.env[k]?.trim();
  if (!v) throw new Error(`defina ${k}`);
  return v;
}

async function main() {
  const email = need('OWNER_EMAIL').toLowerCase();
  const username = need('OWNER_USERNAME').toLowerCase();
  const password = need('OWNER_PASSWORD');
  const serverName = process.env.SERVER_NAME?.trim() || 'OpenCord';
  if (password.length < 12) throw new Error('OWNER_PASSWORD precisa de ao menos 12 caracteres');
  if (!/^[a-z0-9_.]{2,32}$/.test(username)) throw new Error('OWNER_USERNAME inválido');
  const prisma = createPrismaClient();
  try {
    if (await prisma.user.findFirst({ where: { OR: [{ email }, { username }] } }))
      throw new Error('usuário já existe; nada foi alterado');
    const passwordHash = await hash(password, { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 });
    const { server } = await prisma.$transaction(async (tx) => {
      const owner = await tx.user.create({
        data: { email, username, displayName: username, nickKey: nickKeyOf(username), passwordHash },
      });
      const server = await createServerWithDefaults(tx, owner.id, serverName, { official: true });
      await tx.auditLog.create({
        data: { actorId: owner.id, serverId: server.id, action: 'server.bootstrap', targetId: owner.id, metadata: {} },
      });
      return { server };
    });
    console.warn(`Proprietário criado: ${email}\nServidor aberto: ${server.name} (${server.id})`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
