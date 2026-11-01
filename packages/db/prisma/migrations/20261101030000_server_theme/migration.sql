-- Tema por servidor: cor de destaque e papel de parede. Aditiva: duas colunas opcionais.
-- Reverter: ALTER TABLE "Server" DROP COLUMN "accent", DROP COLUMN "wallpaperKey"; (apagar wallpapers/ no armazenamento).
ALTER TABLE "Server" ADD COLUMN "accent" TEXT;
ALTER TABLE "Server" ADD COLUMN "wallpaperKey" TEXT;
