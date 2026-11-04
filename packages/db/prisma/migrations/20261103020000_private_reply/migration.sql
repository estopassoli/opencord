-- Responder no privado (ADR-0042): mensagem de DM que cita uma mensagem de canal.
-- Reversão: ALTER TABLE "Message" DROP CONSTRAINT "Message_privateReplyToId_fkey"; ALTER TABLE "Message" DROP COLUMN "privateReplyToId";
ALTER TABLE "Message" ADD COLUMN "privateReplyToId" UUID;
ALTER TABLE "Message" ADD CONSTRAINT "Message_privateReplyToId_fkey" FOREIGN KEY ("privateReplyToId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;
