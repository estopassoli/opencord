-- Novidades apagadas pelo super admin: a tela Novidades do app esconde as entradas desta lista.
-- Reversão: ALTER TABLE "InstanceConfig" DROP COLUMN "hiddenChangelog";
ALTER TABLE "InstanceConfig" ADD COLUMN "hiddenChangelog" TEXT[] DEFAULT ARRAY[]::TEXT[];
