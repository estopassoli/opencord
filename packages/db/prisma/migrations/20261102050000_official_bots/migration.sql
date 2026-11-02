-- Bots oficiais (ADR-0037): chave fixa do bot reconhecida pelo container dos bots. Aditiva.
-- Reverter: ALTER TABLE "Bot" DROP COLUMN "officialKey";
ALTER TABLE "Bot" ADD COLUMN "officialKey" TEXT;
CREATE UNIQUE INDEX "Bot_ownerId_officialKey_key" ON "Bot"("ownerId", "officialKey");
