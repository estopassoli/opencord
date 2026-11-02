-- Bloqueio automático e de dispositivo (adendo ADR-0036). Aditiva.
-- Reverter: DROP TABLE "DeviceBan"; ALTER TABLE "Session" DROP COLUMN "hardwareId", DROP COLUMN "ip";
--           ALTER TABLE "InstanceConfig" DROP COLUMN "aiAutoBlock", DROP COLUMN "aiAutoBlockDevice";
--           ALTER TABLE "ModerationCase" DROP COLUMN "autoAction";
ALTER TABLE "Session" ADD COLUMN "hardwareId" TEXT, ADD COLUMN "ip" TEXT;
ALTER TABLE "InstanceConfig" ADD COLUMN "aiAutoBlock" BOOLEAN NOT NULL DEFAULT false,
                             ADD COLUMN "aiAutoBlockDevice" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ModerationCase" ADD COLUMN "autoAction" TEXT;
CREATE TABLE "DeviceBan" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "userId" UUID,
    "reason" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DeviceBan_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DeviceBan_kind_value_key" ON "DeviceBan"("kind", "value");
CREATE INDEX "DeviceBan_userId_idx" ON "DeviceBan"("userId");
