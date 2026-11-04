-- Personalização do perfil (ADR-0048): bio, banner (enviado ou GIF do KLIPY), duas cores, foto por GIF do KLIPY e
-- fotos recentes. Reversão: ALTER TABLE "User" DROP COLUMN "bio", DROP COLUMN "bannerKey", DROP COLUMN "bannerUrl",
-- DROP COLUMN "avatarUrl", DROP COLUMN "profileColors", DROP COLUMN "recentAvatars"; (arquivos em banners/ ficam)
ALTER TABLE "User"
  ADD COLUMN "bio" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "bannerKey" TEXT,
  ADD COLUMN "bannerUrl" TEXT,
  ADD COLUMN "avatarUrl" TEXT,
  ADD COLUMN "profileColors" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "recentAvatars" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
