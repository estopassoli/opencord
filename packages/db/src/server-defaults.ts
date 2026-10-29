import { DEFAULT_EVERYONE_PERMISSIONS } from '@opencord/contracts';
import type { Prisma } from '@prisma/client';

export interface ServerOptions {
  /** Servidor oficial da instância: todos os usuários entram e ele aparece no diretório. */
  official?: boolean;
}

/**
 * Servidor sem canais: dono e cargo @everyone. O oficial inclui todos os usuários ativos;
 * os demais (privados) começam só com o dono e crescem por convite.
 */
export async function createServerShell(
  tx: Prisma.TransactionClient,
  ownerId: string,
  name: string,
  everyonePermissions: number = DEFAULT_EVERYONE_PERMISSIONS,
  opts: ServerOptions = {},
) {
  const official = opts.official ?? false;
  const server = await tx.server.create({ data: { name, ownerId, official } });
  const everyone = await tx.role.create({
    data: {
      serverId: server.id,
      name: '@everyone',
      position: 0,
      permissions: everyonePermissions,
      isEveryone: true,
    },
  });
  const users = official ? await tx.user.findMany({ where: { disabledAt: null }, select: { id: true } }) : [];
  const ids = new Set([ownerId, ...users.map((u) => u.id)]);
  await tx.serverMember.createMany({
    data: [...ids].map((userId) => ({ serverId: server.id, userId })),
    skipDuplicates: true,
  });
  return { server, everyone };
}

/** Cria servidor com @everyone, categorias e canais iniciais. */
export async function createServerWithDefaults(
  tx: Prisma.TransactionClient,
  ownerId: string,
  name: string,
  opts: ServerOptions = {},
) {
  const { server } = await createServerShell(tx, ownerId, name, DEFAULT_EVERYONE_PERMISSIONS, opts);
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

/** Adiciona um usuário novo aos servidores oficiais (abertos a todos). Retorna os IDs. */
export async function joinAllServers(tx: Prisma.TransactionClient, userId: string): Promise<string[]> {
  const servers = await tx.server.findMany({ where: { official: true }, select: { id: true } });
  await tx.serverMember.createMany({ data: servers.map((s) => ({ serverId: s.id, userId })), skipDuplicates: true });
  return servers.map((s) => s.id);
}
