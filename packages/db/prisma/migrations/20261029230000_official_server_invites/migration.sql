-- Servidor oficial aberto + servidores privados com convite (revisa ADR-0007).
-- Reversão: DROP TABLE "Invite"; ALTER TABLE "Server" DROP COLUMN "official";
ALTER TABLE "Server" ADD COLUMN "official" BOOLEAN NOT NULL DEFAULT false;

-- O servidor oficial é o criado no bootstrap (auditoria `server.bootstrap`); sem ela, o mais antigo.
UPDATE "Server" SET "official" = true
WHERE "id" = COALESCE(
  (SELECT "serverId" FROM "AuditLog" WHERE "action" = 'server.bootstrap' AND "serverId" IS NOT NULL ORDER BY "createdAt" ASC LIMIT 1),
  (SELECT "id" FROM "Server" ORDER BY "createdAt" ASC LIMIT 1)
);

-- Membros atuais dos servidores privados são mantidos (decisão do mantenedor).

CREATE TABLE "Invite" (
    "code" TEXT NOT NULL,
    "serverId" UUID NOT NULL,
    "creatorId" UUID NOT NULL,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Invite_pkey" PRIMARY KEY ("code")
);
CREATE INDEX "Invite_serverId_idx" ON "Invite"("serverId");
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
