-- Modo lento e canal de fórum (ADR-0052). Tudo aditivo.
-- Modo lento: intervalo mínimo, em segundos, entre duas mensagens da mesma pessoa no canal (0 = desligado).
-- Fórum: canal novo em que cada mensagem raiz é um post com título; as respostas apontam para ele (replyToId).
-- Reversão: ALTER TABLE "Message" DROP COLUMN "title"; ALTER TABLE "Channel" DROP COLUMN "slowmodeSec";
--   o valor 'forum' do enum só sai recriando o tipo (sem canais 'forum': CREATE TYPE novo sem ele, ALTER COLUMN
--   "kind" TYPE novo USING "kind"::text::novo, DROP TYPE antigo, RENAME).
ALTER TYPE "ChannelKind" ADD VALUE IF NOT EXISTS 'forum';

ALTER TABLE "Channel" ADD COLUMN "slowmodeSec" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Message" ADD COLUMN "title" TEXT;
