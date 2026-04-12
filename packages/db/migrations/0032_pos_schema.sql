-- POS schema: menus, categories, items, orders, order items, order sequences

CREATE TABLE IF NOT EXISTS "pos_menus" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"       uuid NOT NULL REFERENCES "organisations"("id"),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
  "name"         text NOT NULL,
  "description"  text,
  "is_active"    boolean NOT NULL DEFAULT true,
  "currency"     text NOT NULL DEFAULT 'USD',
  "deleted_at"   timestamptz,
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  "updated_at"   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_pos_menus_workspace" ON "pos_menus"("workspace_id");
CREATE INDEX IF NOT EXISTS "idx_pos_menus_org"       ON "pos_menus"("org_id");

CREATE TABLE IF NOT EXISTS "pos_categories" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "menu_id"      uuid NOT NULL REFERENCES "pos_menus"("id") ON DELETE CASCADE,
  "name"         text NOT NULL,
  "description"  text,
  "image_url"    text,
  "color"        text,
  "sort_order"   integer NOT NULL DEFAULT 0,
  "is_active"    boolean NOT NULL DEFAULT true,
  "deleted_at"   timestamptz,
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  "updated_at"   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_pos_categories_menu" ON "pos_categories"("menu_id");

CREATE TABLE IF NOT EXISTS "pos_items" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "category_id"   uuid NOT NULL REFERENCES "pos_categories"("id") ON DELETE CASCADE,
  "name"          text NOT NULL,
  "description"   text,
  "image_url"     text,
  "price_cents"   integer NOT NULL DEFAULT 0,
  "is_available"  boolean NOT NULL DEFAULT true,
  "sort_order"    integer NOT NULL DEFAULT 0,
  "tags"          jsonb DEFAULT '[]',
  "modifiers"     jsonb DEFAULT '[]',
  "deleted_at"    timestamptz,
  "created_at"    timestamptz NOT NULL DEFAULT now(),
  "updated_at"    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_pos_items_category" ON "pos_items"("category_id");

CREATE TABLE IF NOT EXISTS "pos_orders" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"        uuid NOT NULL REFERENCES "organisations"("id"),
  "workspace_id"  uuid NOT NULL REFERENCES "workspaces"("id"),
  "device_id"     uuid REFERENCES "devices"("id") ON DELETE SET NULL,
  "order_number"  integer NOT NULL,
  "status"        text NOT NULL DEFAULT 'pending',
  "total_cents"   integer NOT NULL DEFAULT 0,
  "customer_name" text,
  "notes"         text,
  "completed_at"  timestamptz,
  "cancelled_at"  timestamptz,
  "created_at"    timestamptz NOT NULL DEFAULT now(),
  "updated_at"    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_pos_orders_workspace" ON "pos_orders"("workspace_id");
CREATE INDEX IF NOT EXISTS "idx_pos_orders_status"    ON "pos_orders"("status");
CREATE INDEX IF NOT EXISTS "idx_pos_orders_created"   ON "pos_orders"("created_at");

CREATE TABLE IF NOT EXISTS "pos_order_items" (
  "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "order_id"            uuid NOT NULL REFERENCES "pos_orders"("id") ON DELETE CASCADE,
  "item_id"             uuid REFERENCES "pos_items"("id") ON DELETE SET NULL,
  "item_name"           text NOT NULL,
  "item_price_cents"    integer NOT NULL,
  "quantity"            integer NOT NULL DEFAULT 1,
  "notes"               text,
  "selected_modifiers"  jsonb DEFAULT '[]',
  "line_total_cents"    integer NOT NULL DEFAULT 0,
  "created_at"          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_pos_order_items_order" ON "pos_order_items"("order_id");

-- Per-workspace order number counter (used inside a transaction to guarantee uniqueness)
CREATE TABLE IF NOT EXISTS "pos_order_sequences" (
  "workspace_id"      uuid PRIMARY KEY REFERENCES "workspaces"("id"),
  "last_order_number" integer NOT NULL DEFAULT 0,
  "updated_at"        timestamptz NOT NULL DEFAULT now()
);
