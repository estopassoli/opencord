-- Privacidade e dados pessoais (ADR-0039). Aditiva.
-- Reverter: ALTER TABLE "User" DROP COLUMN "termsAcceptedAt", DROP COLUMN "deletedAt";
--           ALTER TABLE "InstanceConfig" DROP COLUMN "privacyContact";
ALTER TABLE "User" ADD COLUMN "termsAcceptedAt" TIMESTAMPTZ(3), ADD COLUMN "deletedAt" TIMESTAMPTZ(3);
ALTER TABLE "InstanceConfig" ADD COLUMN "privacyContact" TEXT;
