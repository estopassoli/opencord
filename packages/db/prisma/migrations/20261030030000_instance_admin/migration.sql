-- Super admin da instância (ADR-0013). Reversão: ALTER TABLE "User" DROP COLUMN "isInstanceAdmin";
ALTER TABLE "User" ADD COLUMN "isInstanceAdmin" BOOLEAN NOT NULL DEFAULT false;

-- O dono do servidor oficial (o proprietário criado no bootstrap) é o primeiro super admin.
UPDATE "User" SET "isInstanceAdmin" = true
WHERE "id" IN (SELECT "ownerId" FROM "Server" WHERE "official" = true);
