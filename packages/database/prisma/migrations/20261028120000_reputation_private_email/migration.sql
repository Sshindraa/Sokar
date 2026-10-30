ALTER TABLE "customers"
  ADD COLUMN "feedback_email_opt_out_at" TIMESTAMP(3),
  ADD COLUMN "feedback_email_requested_at" TIMESTAMP(3);

CREATE TABLE "reputation_email_attempts" (
  "id" TEXT NOT NULL,
  "request_id" TEXT NOT NULL,
  "attempted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reputation_email_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reputation_email_attempts_request_id_fkey"
    FOREIGN KEY ("request_id") REFERENCES "reputation_feedback_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "reputation_email_attempts_attempted_at_idx" ON "reputation_email_attempts"("attempted_at");
