-- DropForeignKey
ALTER TABLE "restaurant_exposure_settings" DROP CONSTRAINT "restaurant_exposure_settings_restaurant_id_fkey";

-- AlterTable
ALTER TABLE "restaurant_exposure_settings" ALTER COLUMN "updated_at" DROP DEFAULT;

-- CreateTable
CREATE TABLE "identity_verification_otps" (
    "id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "otp_hash" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumed_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "identity_verification_otps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signed_token_usages" (
    "jti" TEXT NOT NULL,
    "used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "subject" TEXT,
    "intent" TEXT,

    CONSTRAINT "signed_token_usages_pkey" PRIMARY KEY ("jti")
);

-- CreateIndex
CREATE INDEX "identity_verification_otps_expires_at_idx" ON "identity_verification_otps"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "identity_verification_otps_subject_intent_key" ON "identity_verification_otps"("subject", "intent");

-- CreateIndex
CREATE INDEX "signed_token_usages_used_at_idx" ON "signed_token_usages"("used_at");

-- AddForeignKey
ALTER TABLE "restaurant_exposure_settings" ADD CONSTRAINT "restaurant_exposure_settings_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
