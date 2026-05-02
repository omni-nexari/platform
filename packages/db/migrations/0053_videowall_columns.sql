-- Videowall Phase A: new columns for per-tile metadata and group bezels.
--
-- All changes are additive (ADD COLUMN IF NOT EXISTS) — existing sync groups,
-- device groups, and members are completely unaffected. No existing column is
-- altered or removed.

-- ── device_groups: per-group bezel configuration (mm) ───────────────────────
-- Each field is nullable; NULL means "no bezel compensation" (same as 0 mm).
ALTER TABLE device_groups
  ADD COLUMN IF NOT EXISTS bezel_top_mm    numeric(6,2),
  ADD COLUMN IF NOT EXISTS bezel_right_mm  numeric(6,2),
  ADD COLUMN IF NOT EXISTS bezel_bottom_mm numeric(6,2),
  ADD COLUMN IF NOT EXISTS bezel_left_mm   numeric(6,2);

-- ── device_group_members: per-tile physical and layout metadata ──────────────
-- nativeWidthPx / nativeHeightPx: physical panel resolution in pixels.
--   NULL = default 1920×1080. Used so heterogeneous walls (e.g. a 1920×520 LED
--   bar mixed with 1920×1080 panels) can compute the virtual canvas correctly.
--
-- colSpan / rowSpan: how many grid columns/rows this member's panel occupies.
--   NULL / 1 = single cell (default). A widescreen bar spanning 2 columns = 2.
--
-- tileRotation: physical panel rotation relative to the wall canvas.
--   NULL / '0' = landscape default.
ALTER TABLE device_group_members
  ADD COLUMN IF NOT EXISTS native_width_px  integer,
  ADD COLUMN IF NOT EXISTS native_height_px integer,
  ADD COLUMN IF NOT EXISTS col_span         integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS row_span         integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS tile_rotation    text NOT NULL DEFAULT '0';

-- CHECK constraints keep bad data out without restricting existing rows.
ALTER TABLE device_group_members
  ADD CONSTRAINT chk_dgm_col_span_positive CHECK (col_span >= 1),
  ADD CONSTRAINT chk_dgm_row_span_positive CHECK (row_span >= 1),
  ADD CONSTRAINT chk_dgm_tile_rotation     CHECK (tile_rotation IN ('0','90','180','270'));

-- ── Index: fast lookup of all members for a videowall group ─────────────────
CREATE INDEX IF NOT EXISTS idx_device_group_members_group_col_row
  ON device_group_members(group_id, position_col, position_row);
