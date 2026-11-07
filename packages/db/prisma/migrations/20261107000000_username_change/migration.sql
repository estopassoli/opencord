-- Troca do @ (nome de usuário) uma vez a cada 30 dias: quando foi a última troca (null = nunca trocou).
-- Aditiva; reverter: ALTER TABLE "User" DROP COLUMN "usernameChangedAt";
ALTER TABLE "User" ADD COLUMN "usernameChangedAt" TIMESTAMPTZ(3);
