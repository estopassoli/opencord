-- Encaminhar mensagem (ADR-0053): a cópia guarda de onde veio. Sem chave estrangeira de propósito: a cópia continua
-- "encaminhada" mesmo se a original (ou o canal dela) for apagada; os ids só servem para o link "ver original".
-- Reversão: ALTER TABLE "Message" DROP COLUMN "forwardedFromId", DROP COLUMN "forwardedChannelId";
ALTER TABLE "Message" ADD COLUMN "forwardedFromId" UUID;
ALTER TABLE "Message" ADD COLUMN "forwardedChannelId" UUID;
