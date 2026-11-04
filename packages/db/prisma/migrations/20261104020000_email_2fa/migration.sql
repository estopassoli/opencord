-- E-mail confirmado e verificação em duas etapas por código no e-mail (ADR-0047).
-- Reversão: ALTER TABLE "User" DROP COLUMN "emailVerifiedAt", DROP COLUMN "twoFactorEmailAt";
ALTER TABLE "User"
  ADD COLUMN "emailVerifiedAt" TIMESTAMPTZ(3),
  ADD COLUMN "twoFactorEmailAt" TIMESTAMPTZ(3);
