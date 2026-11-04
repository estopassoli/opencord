-- Notificação padrão do servidor (ADR-0050): o padrão passa a ser "só menções", que é como o app sempre funcionou.
-- A coluna é de 20261105020000 e ninguém a escolheu ainda (a tela é desta mesma leva), então todos voltam ao padrão.
-- Reversão: ALTER TABLE "Server" ALTER COLUMN "defaultNotify" SET DEFAULT 'all';
ALTER TABLE "Server" ALTER COLUMN "defaultNotify" SET DEFAULT 'mentions';
UPDATE "Server" SET "defaultNotify" = 'mentions' WHERE "defaultNotify" = 'all';
