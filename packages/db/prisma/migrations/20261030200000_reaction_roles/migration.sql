-- Cargos por reação (ADR-0019): emoji numa mensagem → cargo.
-- Aditiva. Reversão: DROP TABLE "ReactionRole";
-- CreateTable
CREATE TABLE "ReactionRole" (
    "messageId" UUID NOT NULL,
    "emoji" TEXT NOT NULL,
    "roleId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReactionRole_pkey" PRIMARY KEY ("messageId","emoji")
);

-- CreateIndex
CREATE INDEX "ReactionRole_roleId_idx" ON "ReactionRole"("roleId");

-- AddForeignKey
ALTER TABLE "ReactionRole" ADD CONSTRAINT "ReactionRole_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReactionRole" ADD CONSTRAINT "ReactionRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

