-- Phase 6 POS tables: inventory, employees, time tracking, loyalty, expenses, purchase orders

CREATE TABLE IF NOT EXISTS "pos_inventory_items" (
  "id"             uuid        PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id"         uuid        NOT NULL REFERENCES "organisations"("id"),
  "workspace_id"   uuid        NOT NULL REFERENCES "workspaces"("id"),
  "name"           text        NOT NULL,
  "sku"            text,
  "unit"           text        NOT NULL DEFAULT 'unit',
  "quantity"       integer     NOT NULL DEFAULT 0,
  "reorder_point"  integer     NOT NULL DEFAULT 0,
  "cost_cents"     integer     NOT NULL DEFAULT 0,
  "supplier"       text,
  "notes"          text,
  "is_active"      boolean     NOT NULL DEFAULT true,
  "created_at"     timestamptz NOT NULL DEFAULT now(),
  "updated_at"     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_pos_inventory_workspace" ON "pos_inventory_items"("workspace_id");

CREATE TABLE IF NOT EXISTS "pos_employees" (
  "id"          uuid        PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id"      uuid        NOT NULL REFERENCES "organisations"("id"),
  "workspace_id" uuid       NOT NULL REFERENCES "workspaces"("id"),
  "name"        text        NOT NULL,
  "email"       text,
  "phone"       text,
  "role"        text        NOT NULL DEFAULT 'staff',
  "pin_hash"    text,
  "is_active"   boolean     NOT NULL DEFAULT true,
  "hired_at"    timestamptz,
  "created_at"  timestamptz NOT NULL DEFAULT now(),
  "updated_at"  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_pos_employees_workspace" ON "pos_employees"("workspace_id");

CREATE TABLE IF NOT EXISTS "pos_time_entries" (
  "id"             uuid        PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "employee_id"    uuid        NOT NULL REFERENCES "pos_employees"("id") ON DELETE CASCADE,
  "workspace_id"   uuid        NOT NULL REFERENCES "workspaces"("id"),
  "clocked_in_at"  timestamptz NOT NULL DEFAULT now(),
  "clocked_out_at" timestamptz,
  "break_minutes"  integer     NOT NULL DEFAULT 0,
  "notes"          text,
  "created_at"     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_pos_time_entries_employee" ON "pos_time_entries"("employee_id");
CREATE INDEX IF NOT EXISTS "idx_pos_time_entries_workspace" ON "pos_time_entries"("workspace_id");

CREATE TABLE IF NOT EXISTS "pos_loyalty_customers" (
  "id"          uuid        PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id"      uuid        NOT NULL REFERENCES "organisations"("id"),
  "workspace_id" uuid       NOT NULL REFERENCES "workspaces"("id"),
  "phone"       text,
  "email"       text,
  "name"        text        NOT NULL DEFAULT '',
  "points"      integer     NOT NULL DEFAULT 0,
  "tier"        text        NOT NULL DEFAULT 'bronze',
  "enrolled_at" timestamptz NOT NULL DEFAULT now(),
  "created_at"  timestamptz NOT NULL DEFAULT now(),
  "updated_at"  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_pos_loyalty_workspace" ON "pos_loyalty_customers"("workspace_id");
CREATE INDEX IF NOT EXISTS "idx_pos_loyalty_phone" ON "pos_loyalty_customers"("phone");

CREATE TABLE IF NOT EXISTS "pos_loyalty_events" (
  "id"           uuid        PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "customer_id"  uuid        NOT NULL REFERENCES "pos_loyalty_customers"("id") ON DELETE CASCADE,
  "order_id"     uuid        REFERENCES "pos_orders"("id") ON DELETE SET NULL,
  "type"         text        NOT NULL,
  "points_delta" integer     NOT NULL,
  "notes"        text,
  "created_at"   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_pos_loyalty_events_customer" ON "pos_loyalty_events"("customer_id");

CREATE TABLE IF NOT EXISTS "pos_expenses" (
  "id"           uuid        PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id"       uuid        NOT NULL REFERENCES "organisations"("id"),
  "workspace_id" uuid        NOT NULL REFERENCES "workspaces"("id"),
  "category"     text        NOT NULL DEFAULT 'other',
  "description"  text        NOT NULL,
  "amount_cents" integer     NOT NULL,
  "expense_date" timestamptz NOT NULL DEFAULT now(),
  "receipt_url"  text,
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  "updated_at"   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_pos_expenses_workspace" ON "pos_expenses"("workspace_id");
CREATE INDEX IF NOT EXISTS "idx_pos_expenses_date" ON "pos_expenses"("expense_date");

CREATE TABLE IF NOT EXISTS "pos_purchase_orders" (
  "id"           uuid        PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id"       uuid        NOT NULL REFERENCES "organisations"("id"),
  "workspace_id" uuid        NOT NULL REFERENCES "workspaces"("id"),
  "po_number"    integer     NOT NULL,
  "supplier"     text        NOT NULL,
  "status"       text        NOT NULL DEFAULT 'draft',
  "items"        jsonb       NOT NULL DEFAULT '[]',
  "total_cents"  integer     NOT NULL DEFAULT 0,
  "ordered_at"   timestamptz,
  "expected_at"  timestamptz,
  "delivered_at" timestamptz,
  "notes"        text,
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  "updated_at"   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_pos_purchase_orders_workspace" ON "pos_purchase_orders"("workspace_id");
CREATE INDEX IF NOT EXISTS "idx_pos_purchase_orders_status" ON "pos_purchase_orders"("status");
