-- CreateTable
CREATE TABLE "reactivation_campaigns" (
    "id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "customer_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sent_at" TIMESTAMP(3),
    "sent_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reactivation_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reactivation_campaigns_restaurant_status_created_at_idx" ON "reactivation_campaigns"("restaurant_id", "status", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "reactivation_campaigns" ADD CONSTRAINT "reactivation_campaigns_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
