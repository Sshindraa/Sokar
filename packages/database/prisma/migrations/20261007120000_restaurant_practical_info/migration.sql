-- Faits pratiques du restaurant (parking, accessibilité, animaux, menu…) saisis à l'onboarding.
-- Additif : valeur par défaut vide, aucune donnée existante modifiée.
ALTER TABLE "restaurants"
  ADD COLUMN IF NOT EXISTS "practical_info" JSONB NOT NULL DEFAULT '{}';
