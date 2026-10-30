-- Painel do super admin (ADR-0020): configuração da instância (uma linha) e auditoria global por data.
-- Reversão: DROP TABLE "InstanceConfig"; DROP INDEX "AuditLog_createdAt_idx";

CREATE TABLE "InstanceConfig" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "registrationOpen" BOOLEAN NOT NULL DEFAULT true,
    "announcementText" TEXT,
    "announcementTone" TEXT NOT NULL DEFAULT 'info',
    "uploadMaxBytes" INTEGER,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedById" UUID,

    CONSTRAINT "InstanceConfig_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "InstanceConfig_singleton" CHECK ("id" = 1)
);

CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
