-- Salas privadas (ADR-0040): dono e limite de vagas da sala temporária. Aditiva.
-- Reverter: ALTER TABLE "Channel" DROP COLUMN "ownerId", DROP COLUMN "userLimit";
ALTER TABLE "Channel" ADD COLUMN "ownerId" UUID, ADD COLUMN "userLimit" INTEGER;
