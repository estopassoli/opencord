-- Bots e aplicativos (ADR-0032). Aditiva: coluna com padrão e tabela nova.
-- Reverter: DROP TABLE "Bot"; ALTER TABLE "User" DROP COLUMN "isBot"; (apagar os usuários isBot antes).
ALTER TABLE "User" ADD COLUMN "isBot" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Bot" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "public" BOOLEAN NOT NULL DEFAULT false,
    "tokenHash" TEXT NOT NULL,
    "commands" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMPTZ(3),

    CONSTRAINT "Bot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Bot_userId_key" ON "Bot"("userId");
CREATE UNIQUE INDEX "Bot_tokenHash_key" ON "Bot"("tokenHash");
CREATE INDEX "Bot_ownerId_idx" ON "Bot"("ownerId");

-- AddForeignKey
ALTER TABLE "Bot" ADD CONSTRAINT "Bot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Bot" ADD CONSTRAINT "Bot_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
