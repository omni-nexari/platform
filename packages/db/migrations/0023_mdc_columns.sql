-- MDC state columns (auto-updated every 30s heartbeat / 5min poll from player)
ALTER TABLE "devices"
  ADD COLUMN IF NOT EXISTS "mdc_id"               integer,
  ADD COLUMN IF NOT EXISTS "mdc_volume"            integer,
  ADD COLUMN IF NOT EXISTS "mdc_mute"              boolean,
  ADD COLUMN IF NOT EXISTS "mdc_input"             integer,
  ADD COLUMN IF NOT EXISTS "mdc_standby"           integer,
  ADD COLUMN IF NOT EXISTS "mdc_network_standby"   integer,
  ADD COLUMN IF NOT EXISTS "mdc_remote_control"    integer,
  ADD COLUMN IF NOT EXISTS "mdc_safety_lock"       integer,
  ADD COLUMN IF NOT EXISTS "mdc_software_version"  text,
  ADD COLUMN IF NOT EXISTS "mdc_osd_status"        integer,
  ADD COLUMN IF NOT EXISTS "mdc_menu_orientation"  integer,
  ADD COLUMN IF NOT EXISTS "mdc_src_orientation"   integer,
  ADD COLUMN IF NOT EXISTS "mdc_temperature_c"     double precision,
  ADD COLUMN IF NOT EXISTS "mdc_last_poll"         timestamptz;
