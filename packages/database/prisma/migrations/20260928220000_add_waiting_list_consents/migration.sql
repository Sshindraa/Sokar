-- Preserve existing waiting-list rows while recording explicit consent for new entries.
ALTER TABLE "waiting_list_entries"
ADD COLUMN "consents" JSONB NOT NULL DEFAULT '{}';
