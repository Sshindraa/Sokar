-- Optional per-site override for CRM sensitive-note visibility.
-- NULL keeps the process-level CRM_SENSITIVE_NOTE_ROLES fallback.
ALTER TABLE "restaurants"
ADD COLUMN "crm_sensitive_note_roles" TEXT;
