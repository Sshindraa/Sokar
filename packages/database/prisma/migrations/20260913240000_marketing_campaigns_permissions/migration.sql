-- Marketing P3-02/P3-05: durable campaigns, channel permissions and
-- suppression/frequency projections. All tables are additive; no provider
-- call is made by this migration.

CREATE TYPE "MarketingChannel" AS ENUM (
  'SMS',
  'EMAIL',
  'WHATSAPP'
);

CREATE TYPE "MarketingPermissionStatus" AS ENUM (
  'OPTED_IN',
  'OPTED_OUT',
  'UNKNOWN'
);

CREATE TYPE "MarketingCampaignStatus" AS ENUM (
  'DRAFT',
  'READY',
  'SCHEDULED',
  'SENDING',
  'SENT',
  'PAUSED',
  'CANCELLED',
  'FAILED'
);

CREATE TYPE "MarketingMessageStatus" AS ENUM (
  'PENDING',
  'ACCEPTED',
  'SENT',
  'DELIVERED',
  'FAILED',
  'BOUNCED',
  'COMPLAINED',
  'CANCELLED'
);

CREATE TYPE "MarketingConversionType" AS ENUM (
  'RESERVATION_CREATED',
  'RESERVATION_HONORED'
);

CREATE TABLE "marketing_permissions" (
  "id" TEXT NOT NULL,
  "restaurant_id" TEXT NOT NULL,
  "customer_id" TEXT NOT NULL,
  "channel" "MarketingChannel" NOT NULL,
  "status" "MarketingPermissionStatus" NOT NULL DEFAULT 'UNKNOWN',
  "source" TEXT NOT NULL,
  "proof_version" TEXT,
  "proof_hash" TEXT,
  "consented_at" TIMESTAMP(3),
  "withdrawn_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "marketing_permissions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "marketing_permissions_restaurant_id_fkey"
    FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "marketing_permissions_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "marketing_permissions_customer_channel_key"
  ON "marketing_permissions"("customer_id", "channel");
CREATE INDEX "marketing_permissions_restaurant_channel_status_idx"
  ON "marketing_permissions"("restaurant_id", "channel", "status");
CREATE INDEX "marketing_permissions_customer_updated_idx"
  ON "marketing_permissions"("customer_id", "updated_at");

CREATE TABLE "marketing_permission_events" (
  "id" TEXT NOT NULL,
  "restaurant_id" TEXT NOT NULL,
  "customer_id" TEXT NOT NULL,
  "permission_id" TEXT,
  "channel" "MarketingChannel" NOT NULL,
  "status" "MarketingPermissionStatus" NOT NULL,
  "source" TEXT NOT NULL,
  "proof_version" TEXT,
  "proof_hash" TEXT,
  "occurred_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "marketing_permission_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "marketing_permission_events_restaurant_id_fkey"
    FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "marketing_permission_events_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "marketing_permission_events_permission_id_fkey"
    FOREIGN KEY ("permission_id") REFERENCES "marketing_permissions"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "marketing_permission_events_restaurant_channel_idx"
  ON "marketing_permission_events"("restaurant_id", "channel", "occurred_at");
CREATE INDEX "marketing_permission_events_customer_channel_idx"
  ON "marketing_permission_events"("customer_id", "channel", "occurred_at");

CREATE TABLE "marketing_suppressions" (
  "id" TEXT NOT NULL,
  "restaurant_id" TEXT NOT NULL,
  "customer_id" TEXT NOT NULL,
  "channel" "MarketingChannel",
  "reason" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "marketing_suppressions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "marketing_suppressions_restaurant_id_fkey"
    FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "marketing_suppressions_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "marketing_suppressions_customer_channel_reason_key"
  ON "marketing_suppressions"("customer_id", "channel", "reason");
CREATE INDEX "marketing_suppressions_lookup_idx"
  ON "marketing_suppressions"("restaurant_id", "customer_id", "expires_at");

CREATE TABLE "marketing_campaigns" (
  "id" TEXT NOT NULL,
  "restaurant_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "objective" TEXT NOT NULL,
  "channel" "MarketingChannel" NOT NULL,
  "segment_id" TEXT,
  "status" "MarketingCampaignStatus" NOT NULL DEFAULT 'DRAFT',
  "subject" TEXT,
  "body_template" TEXT NOT NULL,
  "scheduled_at" TIMESTAMP(3),
  "timezone" TEXT NOT NULL DEFAULT 'Europe/Paris',
  "audience_version" INTEGER NOT NULL DEFAULT 1,
  "audience_count" INTEGER NOT NULL DEFAULT 0,
  "accepted_count" INTEGER NOT NULL DEFAULT 0,
  "delivered_count" INTEGER NOT NULL DEFAULT 0,
  "failed_count" INTEGER NOT NULL DEFAULT 0,
  "conversion_count" INTEGER NOT NULL DEFAULT 0,
  "created_by_hash" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "marketing_campaigns_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "marketing_campaigns_restaurant_id_fkey"
    FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "marketing_campaigns_segment_id_fkey"
    FOREIGN KEY ("segment_id") REFERENCES "customer_segments"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "marketing_campaigns_restaurant_status_updated_idx"
  ON "marketing_campaigns"("restaurant_id", "status", "updated_at" DESC);
CREATE INDEX "marketing_campaigns_segment_idx"
  ON "marketing_campaigns"("segment_id");

CREATE TABLE "campaign_audience_members" (
  "id" TEXT NOT NULL,
  "campaign_id" TEXT NOT NULL,
  "customer_id" TEXT NOT NULL,
  "audience_version" INTEGER NOT NULL,
  "inclusion_reason" TEXT NOT NULL,
  "snapshot" JSONB NOT NULL DEFAULT '{}',
  "captured_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "campaign_audience_members_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "campaign_audience_members_campaign_id_fkey"
    FOREIGN KEY ("campaign_id") REFERENCES "marketing_campaigns"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "campaign_audience_members_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "campaign_audience_members_campaign_customer_key"
  ON "campaign_audience_members"("campaign_id", "customer_id");
CREATE INDEX "campaign_audience_members_campaign_version_idx"
  ON "campaign_audience_members"("campaign_id", "audience_version");

CREATE TABLE "campaign_messages" (
  "id" TEXT NOT NULL,
  "campaign_id" TEXT NOT NULL,
  "audience_member_id" TEXT NOT NULL,
  "customer_id" TEXT NOT NULL,
  "channel" "MarketingChannel" NOT NULL,
  "status" "MarketingMessageStatus" NOT NULL DEFAULT 'PENDING',
  "provider" TEXT,
  "provider_message_id" TEXT,
  "rendered_body" TEXT,
  "idempotency_key" TEXT NOT NULL,
  "error_code" TEXT,
  "accepted_at" TIMESTAMP(3),
  "sent_at" TIMESTAMP(3),
  "delivered_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "campaign_messages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "campaign_messages_campaign_id_fkey"
    FOREIGN KEY ("campaign_id") REFERENCES "marketing_campaigns"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "campaign_messages_audience_member_id_fkey"
    FOREIGN KEY ("audience_member_id") REFERENCES "campaign_audience_members"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "campaign_messages_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "campaign_messages_audience_member_id_key"
  ON "campaign_messages"("audience_member_id");
CREATE UNIQUE INDEX "campaign_messages_idempotency_key_key"
  ON "campaign_messages"("idempotency_key");
CREATE INDEX "campaign_messages_campaign_status_idx"
  ON "campaign_messages"("campaign_id", "status");
CREATE INDEX "campaign_messages_customer_channel_idx"
  ON "campaign_messages"("customer_id", "channel", "created_at");

CREATE TABLE "marketing_conversions" (
  "id" TEXT NOT NULL,
  "campaign_id" TEXT NOT NULL,
  "customer_id" TEXT NOT NULL,
  "reservation_id" TEXT,
  "conversion_type" "MarketingConversionType" NOT NULL,
  "conversion_key" TEXT NOT NULL,
  "attributed_at" TIMESTAMP(3) NOT NULL,
  "window_ends_at" TIMESTAMP(3),
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "marketing_conversions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "marketing_conversions_campaign_id_fkey"
    FOREIGN KEY ("campaign_id") REFERENCES "marketing_campaigns"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "marketing_conversions_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "marketing_conversions_reservation_id_fkey"
    FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "marketing_conversions_conversion_key_key"
  ON "marketing_conversions"("conversion_key");
CREATE INDEX "marketing_conversions_campaign_type_idx"
  ON "marketing_conversions"("campaign_id", "conversion_type", "attributed_at");
CREATE INDEX "marketing_conversions_reservation_type_idx"
  ON "marketing_conversions"("reservation_id", "conversion_type");

CREATE TABLE "marketing_frequency_windows" (
  "id" TEXT NOT NULL,
  "restaurant_id" TEXT NOT NULL,
  "customer_id" TEXT NOT NULL,
  "channel" "MarketingChannel" NOT NULL,
  "window_start" TIMESTAMP(3) NOT NULL,
  "window_end" TIMESTAMP(3) NOT NULL,
  "send_count" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "marketing_frequency_windows_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "marketing_frequency_windows_restaurant_id_fkey"
    FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "marketing_frequency_windows_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "marketing_frequency_windows_customer_channel_start_key"
  ON "marketing_frequency_windows"("customer_id", "channel", "window_start");
CREATE INDEX "marketing_frequency_windows_lookup_idx"
  ON "marketing_frequency_windows"("restaurant_id", "channel", "window_end");
