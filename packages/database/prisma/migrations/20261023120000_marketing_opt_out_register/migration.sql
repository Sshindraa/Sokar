-- Preuve de consentement complète et registre d'opposition (docs/architecture/proposal-marketing-proof-and-optout-register.md).
--
-- Migration additive et sans perte : deux colonnes NULLables sur `marketing_permission_events` (aucune
-- ligne existante n'est lue ni modifiée) et une table neuve `marketing_opt_outs`, vide. Aucune
-- suppression de donnée ni de structure. Le registre ne contient qu'un HMAC de l'adresse (clé MARKETING_OPTOUT_HASH_SECRET),
-- jamais l'adresse. Retour arrière : retirer les deux colonnes et la table
-- marketing_opt_outs, après déploiement d'un code qui ne les utilise plus.

-- AlterTable
ALTER TABLE "marketing_permission_events" ADD COLUMN     "actor_user_id" TEXT,
ADD COLUMN     "proof_text" TEXT;

-- CreateTable
CREATE TABLE "marketing_opt_outs" (
    "id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "channel" "MarketingChannel" NOT NULL,
    "address_hash" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "opted_out_at" TIMESTAMP(3) NOT NULL,
    "retain_until" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketing_opt_outs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "marketing_opt_outs_retain_until_idx" ON "marketing_opt_outs"("retain_until");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_opt_outs_restaurant_channel_hash_key" ON "marketing_opt_outs"("restaurant_id", "channel", "address_hash");

-- AddForeignKey
ALTER TABLE "marketing_opt_outs" ADD CONSTRAINT "marketing_opt_outs_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

