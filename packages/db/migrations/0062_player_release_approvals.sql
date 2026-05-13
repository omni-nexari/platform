-- Migration: player release approval flow
-- Adds superadmin_approved_at to player_releases
-- Creates player_release_approvals table for per-management-company approval

ALTER TABLE "player_releases"
  ADD COLUMN "superadmin_approved_at" timestamp with time zone;

--> statement-breakpoint

CREATE TABLE "player_release_approvals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "release_id" uuid NOT NULL REFERENCES "player_releases"("id") ON DELETE CASCADE,
  "management_company_id" uuid NOT NULL,
  "approved_at" timestamp with time zone DEFAULT now() NOT NULL,
  "approved_by" uuid
);

--> statement-breakpoint

CREATE UNIQUE INDEX "uq_player_release_approvals_release_company"
  ON "player_release_approvals" ("release_id", "management_company_id");
