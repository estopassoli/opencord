-- Quadros kanban (ADR-0017): canal do tipo "board", canal de texto que alimenta um quadro e cards.
-- Aditiva. Reversão: DROP TABLE "BoardCard"; DROP TYPE "BoardColumn"; ALTER TABLE "Channel" DROP COLUMN "boardId";
-- (o valor "board" do enum ChannelKind não sai sem recriar o tipo; sem canais "board" ele é inofensivo)
-- CreateEnum
CREATE TYPE "BoardColumn" AS ENUM ('new', 'triage', 'doing', 'done');

-- AlterEnum
ALTER TYPE "ChannelKind" ADD VALUE 'board';

-- AlterTable
ALTER TABLE "Channel" ADD COLUMN     "boardId" UUID;

-- CreateTable
CREATE TABLE "BoardCard" (
    "id" UUID NOT NULL,
    "boardId" UUID NOT NULL,
    "column" "BoardColumn" NOT NULL DEFAULT 'new',
    "position" DOUBLE PRECISION NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "reporterId" UUID,
    "messageId" UUID,
    "sourceChannelId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "BoardCard_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BoardCard_messageId_key" ON "BoardCard"("messageId");

-- CreateIndex
CREATE INDEX "BoardCard_boardId_column_position_idx" ON "BoardCard"("boardId", "column", "position");

-- AddForeignKey
ALTER TABLE "Channel" ADD CONSTRAINT "Channel_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardCard" ADD CONSTRAINT "BoardCard_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardCard" ADD CONSTRAINT "BoardCard_sourceChannelId_fkey" FOREIGN KEY ("sourceChannelId") REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardCard" ADD CONSTRAINT "BoardCard_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardCard" ADD CONSTRAINT "BoardCard_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

