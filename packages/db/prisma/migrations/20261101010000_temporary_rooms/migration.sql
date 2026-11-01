-- Salas de voz temporárias (ADR-0029). Aditiva: duas colunas com padrão. Reverter: ALTER TABLE "Channel" DROP COLUMN
-- "roomHub", DROP COLUMN "temporary"; (salas temporárias existentes viram canais comuns).
ALTER TABLE "Channel" ADD COLUMN "roomHub" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Channel" ADD COLUMN "temporary" BOOLEAN NOT NULL DEFAULT false;
