-- Verificação em duas etapas (ADR-0046): segredo TOTP criptografado, códigos de recuperação em hash, anti-replay.
-- Reversão: ALTER TABLE "User" DROP COLUMN "totpSecret", DROP COLUMN "totpEnabledAt", DROP COLUMN "totpRecoveryHashes", DROP COLUMN "totpLastStep";
ALTER TABLE "User"
  ADD COLUMN "totpSecret" TEXT,
  ADD COLUMN "totpEnabledAt" TIMESTAMPTZ(3),
  ADD COLUMN "totpRecoveryHashes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "totpLastStep" BIGINT;
