-- AlterTable
ALTER TABLE "Server" ADD COLUMN     "isDefault" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "nickKey" TEXT,
ALTER COLUMN "email" DROP NOT NULL,
ALTER COLUMN "passwordHash" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "User_nickKey_key" ON "User"("nickKey");


-- Backfill (ADR-0007): apelido normalizado = minúsculas, sem acentos e com espaços colapsados (mesma regra de `nickKeyOf`).
-- Nomes duplicados recebem sufixo do id para não violar a unicidade.
UPDATE "User" u SET "nickKey" = k.key
FROM (
  SELECT id, regexp_replace(translate(lower(trim("displayName")), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'), '\s+', ' ', 'g') AS key
  FROM "User"
) k
WHERE k.id = u.id
  AND NOT EXISTS (
    SELECT 1 FROM "User" o
    WHERE o.id <> u.id
      AND regexp_replace(translate(lower(trim(o."displayName")), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'), '\s+', ' ', 'g') = k.key
  );
UPDATE "User" SET "nickKey" = lower("displayName") || '#' || substr(replace(id::text, '-', ''), 25, 8) WHERE "nickKey" IS NULL;

-- O servidor mais antigo vira padrão para quem entra só com apelido.
UPDATE "Server" SET "isDefault" = true WHERE id = (SELECT id FROM "Server" ORDER BY "createdAt" ASC LIMIT 1);
