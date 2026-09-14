-- Link the legacy VIP reactivation workflow to the governed marketing
-- campaign pipeline. The column is nullable so existing PENDING/SENT/
-- DISMISSED rows remain readable during the migration.
ALTER TABLE "reactivation_campaigns"
ADD COLUMN "marketing_campaign_id" TEXT;

CREATE UNIQUE INDEX "reactivation_campaigns_marketing_campaign_id_key"
ON "reactivation_campaigns"("marketing_campaign_id");

ALTER TABLE "reactivation_campaigns"
ADD CONSTRAINT "reactivation_campaigns_marketing_campaign_id_fkey"
FOREIGN KEY ("marketing_campaign_id") REFERENCES "marketing_campaigns"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
