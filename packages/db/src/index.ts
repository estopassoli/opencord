import { PrismaClient } from '@prisma/client';

export { PrismaClient, Prisma } from '@prisma/client';
export type * from '@prisma/client';
export { createServerShell, createServerWithDefaults, joinAllServers } from './server-defaults.js';

export function createPrismaClient(url?: string): PrismaClient {
  return new PrismaClient(url ? { datasourceUrl: url } : undefined);
}
