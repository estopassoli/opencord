-- Reversão: só é possível se todos os usuários tiverem e-mail e senha (remova antes os usuários só com apelido).
ALTER TABLE "Server" DROP COLUMN "isDefault";
DROP INDEX IF EXISTS "User_nickKey_key";
ALTER TABLE "User" DROP COLUMN "nickKey";
ALTER TABLE "User" ALTER COLUMN "passwordHash" SET NOT NULL;
ALTER TABLE "User" ALTER COLUMN "email" SET NOT NULL;
