-- Marketing P4-01: expiring signed-link registry. Tokens are hashed at rest
-- and the table is only used for attribution, never for authentication.

CREATE TABLE "marketing_attribution_links" (
  "id" TEXT NOT NULL,
  "restaurant_id" TEXT NOT NULL,
  "campaign_id" TEXT NOT NULL,
  "customer_id" TEXT NOT NULL,
  "token_hash" TEXT NOT NULL,
  "issued_at" TIMESTAMP(3) NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "clicked_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "marketing_attribution_links_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "marketing_attribution_links_restaurant_id_fkey"
    FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "marketing_attribution_links_campaign_id_fkey"
    FOREIGN KEY ("campaign_id") REFERENCES "marketing_campaigns"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "marketing_attribution_links_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "marketing_attribution_links_token_hash_key"
  ON "marketing_attribution_links"("token_hash");
CREATE UNIQUE INDEX "marketing_attribution_links_campaign_customer_key"
  ON "marketing_attribution_links"("campaign_id", "customer_id");
CREATE INDEX "marketing_attribution_links_restaurant_expiry_idx"
  ON "marketing_attribution_links"("restaurant_id", "expires_at");
CREATE INDEX "marketing_attribution_links_campaign_clicked_idx"
  ON "marketing_attribution_links"("campaign_id", "clicked_at");
