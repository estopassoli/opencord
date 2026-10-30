-- Selo de verificado independente de "oficial" (ADR-0013): só exibe o selo; o super admin marca pelo app.
-- Reversão: ALTER TABLE "Server" DROP COLUMN "verified";
ALTER TABLE "Server" ADD COLUMN "verified" BOOLEAN NOT NULL DEFAULT false;
