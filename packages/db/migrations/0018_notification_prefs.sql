CREATE TABLE IF NOT EXISTS notification_prefs (
	user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	event_key text NOT NULL,
	in_app boolean NOT NULL DEFAULT true,
	email_notify boolean NOT NULL DEFAULT false,
	created_at timestamp with time zone NOT NULL DEFAULT now(),
	updated_at timestamp with time zone NOT NULL DEFAULT now(),
	PRIMARY KEY (user_id, event_key)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS notification_prefs_user_id_idx ON notification_prefs (user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS notification_prefs_event_key_idx ON notification_prefs (event_key);
