ALTER TABLE "agent_personalities"
ADD COLUMN "volume" DECIMAL(3,2) NOT NULL DEFAULT 1.0,
ADD COLUMN "emotion" TEXT;
