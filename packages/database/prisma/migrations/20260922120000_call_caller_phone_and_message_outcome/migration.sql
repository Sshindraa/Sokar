-- Two additive changes that make a finished call exploitable:
--   1. `caller_phone` lets the incomplete-call sweep dispatch the commercial
--      recovery for an abandoned booking, which previously required the live
--      Telnyx webhook payload.
--   2. `MESSAGE` distinguishes "message recorded for the manager" from a plain
--      no-action call, so the dashboard stops reporting a handled call as an
--      abandonment.
-- Both are additive: no backfill, no destructive statement.
ALTER TABLE "calls"
ADD COLUMN "caller_phone" TEXT;

ALTER TYPE "CallOutcome"
ADD VALUE IF NOT EXISTS 'MESSAGE';
