import { DEFAULT_EVERYONE_PERMISSIONS } from '@opencord/contracts';
import type { Prisma } from '@prisma/client';

/** Cria servidor com @everyone, categorias e canais iniciais; todos os usuários entram como membros. */
/** Servidor sem canais: dono, cargo @everyone e membros (servidores abertos, ADR-0007). */
export async function createServerShell(
  tx: Prisma.TransactionClient,
  ownerId: string,
  name: string,
  everyonePermissions: number = DEFAULT_EVERYONE_PERMISSIONS,
) {
  const server = await tx.server.create({ data: { name, ownerId } });
  const everyone = await tx.role.create({
    data: {
      serverId: server.id,
      name: '@everyone',
      position: 0,
      permissions: everyonePermissions,
      isEveryone: true,
    },
  });
  // Servidores são abertos (ADR-0007): todos os usuários ativos entram como membros, sem convite.
  const users = await tx.user.findMany({ where: { disabledAt: null }, select: { id: true } });
  const ids = new Set([ownerId, ...users.map((u) => u.id)]);
  await tx.serverMember.createMany({
    data: [...ids].map((userId) => ({ serverId: server.id, userId })),
    skipDuplicates: true,
  });
  return { server, everyone };
}

export async function createServerWithDefaults(tx: Prisma.TransactionClient, ownerId: string, name: string) {
  const { server } = await createServerShell(tx, ownerId, name);
  const text = await tx.category.create({ data: { serverId: server.id, name: 'Canais de texto', position: 0 } });
  const voice = await tx.category.create({ data: { serverId: server.id, name: 'Canais de voz', position: 1 } });
  await tx.channel.create({
    data: { serverId: server.id, categoryId: text.id, kind: 'text', name: 'geral', position: 0 },
  });
  await tx.channel.create({
    data: { serverId: server.id, categoryId: voice.id, kind: 'voice', name: 'Sala', position: 0 },
  });
  return server;
}

/** Adiciona um usuário novo a todos os servidores (servidores abertos, ADR-0007). Retorna os IDs. */
export async function joinAllServers(tx: Prisma.TransactionClient, userId: string): Promise<string[]> {
  const servers = await tx.server.findMany({ select: { id: true } });
  await tx.serverMember.createMany({ data: servers.map((s) => ({ serverId: s.id, userId })), skipDuplicates: true });
  return servers.map((s) => s.id);
}
