-- Insígnias em destaque (adendo ADR-0043): a pessoa escolhe até 3 das suas para aparecer ao lado do nome.
-- Reversão: ALTER TABLE "UserBadge" DROP COLUMN "featured";
ALTER TABLE "UserBadge" ADD COLUMN "featured" BOOLEAN NOT NULL DEFAULT false;
