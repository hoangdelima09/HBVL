-- Profile pictures: every account may upload one avatar (square image variants, public once set).
ALTER TYPE "MediaPurpose" ADD VALUE IF NOT EXISTS 'AVATAR';

ALTER TABLE "users" ADD COLUMN "avatarAssetId" UUID;
CREATE UNIQUE INDEX "users_avatarAssetId_key" ON "users"("avatarAssetId");
ALTER TABLE "users" ADD CONSTRAINT "users_avatarAssetId_fkey" FOREIGN KEY ("avatarAssetId") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
