-- ADR-0007: servidores abertos a todos; convites deixam de existir.
DROP TABLE "Invite";
ALTER TABLE "Server" DROP COLUMN "isDefault";

-- Todos os usuários passam a ser membros de todos os servidores (sem convite).
INSERT INTO "ServerMember" ("serverId", "userId")
SELECT s.id, u.id FROM "Server" s CROSS JOIN "User" u
WHERE u."disabledAt" IS NULL
ON CONFLICT DO NOTHING;
