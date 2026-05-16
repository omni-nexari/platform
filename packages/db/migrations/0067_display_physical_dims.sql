-- Display physical dimensions: active panel area in mm.
-- Used to convert videowall bezel mm values to pixels for CSS scale compensation.
-- Populated automatically from the display preset library when modelCode is recognised on pairing.

ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "physical_width_mm"  double precision;
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "physical_height_mm" double precision;
