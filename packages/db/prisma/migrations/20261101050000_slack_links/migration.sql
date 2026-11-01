-- Ponte com o Slack (ADR-0033). Aditiva: tabela nova.
-- Reverter: DROP TABLE "SlackLink";
CREATE TABLE "SlackLink" (
    "id" UUID NOT NULL,
    "serverId" UUID NOT NULL,
    "channelId" UUID NOT NULL,
    "slackChannelId" TEXT NOT NULL,
    "slackChannelName" TEXT NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SlackLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SlackLink_channelId_key" ON "SlackLink"("channelId");
CREATE UNIQUE INDEX "SlackLink_slackChannelId_key" ON "SlackLink"("slackChannelId");
CREATE INDEX "SlackLink_serverId_idx" ON "SlackLink"("serverId");

ALTER TABLE "SlackLink" ADD CONSTRAINT "SlackLink_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SlackLink" ADD CONSTRAINT "SlackLink_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
