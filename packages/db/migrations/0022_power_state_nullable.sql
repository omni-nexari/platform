-- Make power_state nullable (remove hardcoded default 'on')
-- Devices will show no power badge until MDC reports the real state.
ALTER TABLE "devices" ALTER COLUMN "power_state" DROP NOT NULL;
ALTER TABLE "devices" ALTER COLUMN "power_state" DROP DEFAULT;
UPDATE "devices" SET "power_state" = NULL WHERE "power_state" = 'on';
