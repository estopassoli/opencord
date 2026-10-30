-- Mensagens fixadas (canais e conversas diretas).
-- Aditiva. Reversão: ALTER TABLE "Message" DROP COLUMN "pinnedAt", DROP COLUMN "pinnedById";
-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "pinnedAt" TIMESTAMPTZ(3),
ADD COLUMN     "pinnedById" UUID;
