-- CreateIndex
CREATE INDEX "agentic_holds_status_expires_at_idx" ON "agentic_holds"("status", "expires_at");

-- CreateIndex
CREATE INDEX "reservation_audit_log_actor_hash_idx" ON "reservation_audit_log"("actor_hash");

-- CreateIndex
CREATE INDEX "reservation_audit_log_event_created_at_idx" ON "reservation_audit_log"("event", "created_at");
