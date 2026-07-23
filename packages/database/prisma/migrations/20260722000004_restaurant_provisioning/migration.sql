-- AlterTable
ALTER TABLE "restaurants" ADD COLUMN "provisioning_status" TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE "restaurants" ADD COLUMN "telnyx_phone_number_id" TEXT;
ALTER TABLE "restaurants" ADD COLUMN "forwarding_configured_at" TIMESTAMP(3);
ALTER TABLE "restaurants" ADD COLUMN "test_call_validated_at" TIMESTAMP(3);
