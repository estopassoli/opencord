-- Super admin invisível num servidor (adendo da ADR-0013). Aditiva.
-- Reverter: ALTER TABLE "ServerMember" DROP COLUMN "hidden";
ALTER TABLE "ServerMember" ADD COLUMN "hidden" BOOLEAN NOT NULL DEFAULT false;
