CREATE TABLE IF NOT EXISTS support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_type text NOT NULL,
  company_id uuid REFERENCES management_companies(id) ON DELETE SET NULL,
  org_id uuid REFERENCES organisations(id) ON DELETE SET NULL,
  submitted_by_admin_id uuid,
  submitted_by_user_id uuid,
  submitted_by_name text NOT NULL DEFAULT '',
  submitted_by_email text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'general',
  subject text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  priority text NOT NULL DEFAULT 'medium',
  assigned_to_owner_id uuid,
  closed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS support_ticket_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  sender_type text NOT NULL,
  sender_id uuid NOT NULL,
  sender_name text NOT NULL,
  body text NOT NULL,
  attachment_urls text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS support_tickets_company_id_idx ON support_tickets(company_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS support_tickets_org_id_idx ON support_tickets(org_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS support_tickets_status_idx ON support_tickets(status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS support_ticket_messages_ticket_id_idx ON support_ticket_messages(ticket_id);
