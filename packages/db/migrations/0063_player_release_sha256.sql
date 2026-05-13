-- Add sha256 column to player_releases for cross-platform installer integrity verification.
-- sha512 already exists (used by electron-updater); sha256 is used by Tizen/ePaper/player-web installers.
ALTER TABLE "player_releases" ADD COLUMN IF NOT EXISTS "sha256" text;
