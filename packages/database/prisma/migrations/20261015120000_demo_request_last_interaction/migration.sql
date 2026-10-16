-- Date du dernier échange explicitement enregistré par un opérateur.
-- Nullable pour préserver les demandes déjà présentes sans inventer de date.
ALTER TABLE "demo_requests"
ADD COLUMN "last_interaction_at" TIMESTAMP(3);
