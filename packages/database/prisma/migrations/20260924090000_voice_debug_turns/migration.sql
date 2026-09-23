-- Additive: per-turn dialogue for test restaurants only
-- (VOICE_DEBUG_TRANSCRIPT_RESTAURANT_IDS), purged daily after expires_at (14 days).

-- CreateTable
CREATE TABLE "voice_debug_turns" (
    "id" TEXT NOT NULL,
    "call_id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "turn_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "caller_text" TEXT,
    "agent_text" TEXT,
    "filler_text" TEXT,
    "speech_act" TEXT,
    "tools" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "voice_debug_turns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "voice_debug_turns_restaurant_created_at_idx" ON "voice_debug_turns"("restaurant_id", "created_at");

-- CreateIndex
CREATE INDEX "voice_debug_turns_expires_at_idx" ON "voice_debug_turns"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "voice_debug_turns_call_turn_key" ON "voice_debug_turns"("call_id", "turn_id");

-- AddForeignKey
ALTER TABLE "voice_debug_turns" ADD CONSTRAINT "voice_debug_turns_call_id_fkey" FOREIGN KEY ("call_id") REFERENCES "calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

