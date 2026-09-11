-- New restaurants use an online group-size default of eight.
-- Existing restaurant values are intentionally preserved because onboarding
-- and the dashboard allow each restaurant to choose its own limit.
ALTER TABLE "restaurant_exposure_settings"
ALTER COLUMN "max_party_size" SET DEFAULT 8;
