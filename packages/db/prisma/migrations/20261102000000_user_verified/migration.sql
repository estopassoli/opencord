-- Selo de verificado em perfis (adendo da ADR-0013): o super admin marca pessoas. Aditiva.
-- Reverter: ALTER TABLE "User" DROP COLUMN "verified";
ALTER TABLE "User" ADD COLUMN "verified" BOOLEAN NOT NULL DEFAULT false;
