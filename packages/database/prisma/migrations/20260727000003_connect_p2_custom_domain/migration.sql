-- Sokar Connect P2: Premium subdomain via Cloudflare for SaaS
-- Add customDomain fields to restaurant_exposure_settings (additive, no data loss)

ALTER TABLE "restaurant_exposure_settings" ADD COLUMN "custom_domain" TEXT;
ALTER TABLE "restaurant_exposure_settings" ADD COLUMN "custom_domain_status" TEXT;
ALTER TABLE "restaurant_exposure_settings" ADD COLUMN "custom_domain_validated_at" TIMESTAMP(3);
ALTER TABLE "restaurant_exposure_settings" ADD COLUMN "custom_domain_cf_id" TEXT;

-- Unique constraint on customDomain (one restaurant per domain)
CREATE UNIQUE INDEX "restaurant_exposure_settings_custom_domain_key" ON "restaurant_exposure_settings"("custom_domain");
