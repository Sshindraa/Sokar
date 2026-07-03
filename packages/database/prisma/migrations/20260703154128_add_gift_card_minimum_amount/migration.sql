-- DropForeignKey
ALTER TABLE "onboarding_events" DROP CONSTRAINT "onboarding_events_restaurant_id_fkey";

-- DropForeignKey
ALTER TABLE "reactivation_campaigns" DROP CONSTRAINT "reactivation_campaigns_restaurant_id_fkey";

-- AlterTable
ALTER TABLE "agent_clients" ALTER COLUMN "scopes" SET DEFAULT ARRAY['mcp:read', 'mcp:reserve', 'mcp:cancel']::TEXT[],
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "reactivation_campaigns" ALTER COLUMN "customer_ids" DROP DEFAULT;

-- AlterTable
ALTER TABLE "restaurants" ADD COLUMN     "gift_card_minimum_amount" INTEGER;

-- AddForeignKey
ALTER TABLE "reactivation_campaigns" ADD CONSTRAINT "reactivation_campaigns_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_events" ADD CONSTRAINT "onboarding_events_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
