-- Demandes de démonstration envoyées depuis la vitrine (sans compte Clerk).
-- Table dédiée, sans lien avec un restaurant : additive, aucune donnée existante modifiée.
-- CreateEnum
CREATE TYPE "DemoRequestStatus" AS ENUM ('NEW', 'CONTACTED', 'DEMO_DONE', 'CLOSED');

-- CreateTable
CREATE TABLE "demo_requests" (
    "id" TEXT NOT NULL,
    "idempotency_key" VARCHAR(64) NOT NULL,
    "establishment_name" VARCHAR(120) NOT NULL,
    "contact_email" VARCHAR(254) NOT NULL,
    "contact_phone" VARCHAR(32),
    "current_tool" VARCHAR(120),
    "main_problem" VARCHAR(500),
    "page_version" VARCHAR(40) NOT NULL,
    "status" "DemoRequestStatus" NOT NULL DEFAULT 'NEW',
    "notified_at" TIMESTAMP(3),
    "contacted_at" TIMESTAMP(3),
    "demo_done_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "demo_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "demo_requests_idempotency_key_key" ON "demo_requests"("idempotency_key");

-- CreateIndex
CREATE INDEX "demo_requests_status_created_idx" ON "demo_requests"("status", "created_at");

