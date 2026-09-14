-- P8 local foundation: post-visit feedback and operator recovery tasks.
-- Tokens are opaque and only their SHA-256 hashes are persisted. No review
-- platform or messaging provider is contacted by this migration.

CREATE TYPE "ReputationFeedbackChannel" AS ENUM (
  'SMS',
  'EMAIL',
  'WHATSAPP'
);

CREATE TYPE "ReputationFeedbackRequestStatus" AS ENUM (
  'PENDING',
  'SENT',
  'SUBMITTED',
  'EXPIRED',
  'CANCELLED'
);

CREATE TYPE "ReputationRecoveryTaskStatus" AS ENUM (
  'OPEN',
  'IN_PROGRESS',
  'RESOLVED',
  'DISMISSED'
);

CREATE TYPE "ReputationRecoveryPriority" AS ENUM (
  'HIGH',
  'NORMAL'
);

CREATE TABLE "reputation_feedback_requests" (
  "id" TEXT NOT NULL,
  "restaurant_id" TEXT NOT NULL,
  "reservation_id" TEXT NOT NULL,
  "customer_id" TEXT NOT NULL,
  "channel" "ReputationFeedbackChannel" NOT NULL,
  "status" "ReputationFeedbackRequestStatus" NOT NULL DEFAULT 'PENDING',
  "token_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sent_at" TIMESTAMP(3),
  "submitted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "reputation_feedback_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reputation_feedback_requests_restaurant_id_fkey"
    FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "reputation_feedback_requests_reservation_id_fkey"
    FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "reputation_feedback_requests_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "reputation_feedback_requests_reservation_id_key"
  ON "reputation_feedback_requests"("reservation_id");
CREATE UNIQUE INDEX "reputation_feedback_requests_token_hash_key"
  ON "reputation_feedback_requests"("token_hash");
CREATE INDEX "reputation_feedback_requests_status_expiry_idx"
  ON "reputation_feedback_requests"("restaurant_id", "status", "expires_at");
CREATE INDEX "reputation_feedback_requests_restaurant_requested_idx"
  ON "reputation_feedback_requests"("restaurant_id", "requested_at");
CREATE INDEX "reputation_feedback_requests_customer_requested_idx"
  ON "reputation_feedback_requests"("customer_id", "requested_at");

CREATE TABLE "reputation_feedback" (
  "id" TEXT NOT NULL,
  "request_id" TEXT NOT NULL,
  "restaurant_id" TEXT NOT NULL,
  "reservation_id" TEXT NOT NULL,
  "customer_id" TEXT NOT NULL,
  "score" INTEGER NOT NULL,
  "comment" TEXT,
  "submitted_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reputation_feedback_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reputation_feedback_request_id_fkey"
    FOREIGN KEY ("request_id") REFERENCES "reputation_feedback_requests"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "reputation_feedback_restaurant_id_fkey"
    FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "reputation_feedback_reservation_id_fkey"
    FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "reputation_feedback_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "reputation_feedback_score_check" CHECK ("score" BETWEEN 1 AND 5)
);

CREATE UNIQUE INDEX "reputation_feedback_request_id_key"
  ON "reputation_feedback"("request_id");
CREATE INDEX "reputation_feedback_restaurant_submitted_idx"
  ON "reputation_feedback"("restaurant_id", "submitted_at");
CREATE INDEX "reputation_feedback_restaurant_score_idx"
  ON "reputation_feedback"("restaurant_id", "score", "submitted_at");
CREATE INDEX "reputation_feedback_customer_submitted_idx"
  ON "reputation_feedback"("customer_id", "submitted_at");

CREATE TABLE "reputation_recovery_tasks" (
  "id" TEXT NOT NULL,
  "feedback_id" TEXT NOT NULL,
  "restaurant_id" TEXT NOT NULL,
  "reservation_id" TEXT NOT NULL,
  "customer_id" TEXT NOT NULL,
  "status" "ReputationRecoveryTaskStatus" NOT NULL DEFAULT 'OPEN',
  "priority" "ReputationRecoveryPriority" NOT NULL DEFAULT 'NORMAL',
  "assigned_to_hash" TEXT,
  "resolution_code" TEXT,
  "resolution_note" TEXT,
  "resolved_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "reputation_recovery_tasks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reputation_recovery_tasks_feedback_id_fkey"
    FOREIGN KEY ("feedback_id") REFERENCES "reputation_feedback"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "reputation_recovery_tasks_restaurant_id_fkey"
    FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "reputation_recovery_tasks_reservation_id_fkey"
    FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "reputation_recovery_tasks_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "reputation_recovery_tasks_resolution_code_check"
    CHECK ("resolution_code" IS NULL OR "resolution_code" ~ '^[A-Z][A-Z0-9_.-]{1,31}$')
);

CREATE UNIQUE INDEX "reputation_recovery_tasks_feedback_id_key"
  ON "reputation_recovery_tasks"("feedback_id");
CREATE INDEX "reputation_recovery_tasks_queue_idx"
  ON "reputation_recovery_tasks"("restaurant_id", "status", "priority", "created_at");
CREATE INDEX "reputation_recovery_tasks_restaurant_updated_idx"
  ON "reputation_recovery_tasks"("restaurant_id", "updated_at");
