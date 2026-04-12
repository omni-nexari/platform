-- pos_payments: one payment record per order
CREATE TABLE IF NOT EXISTS "pos_payments" (
  "id"           uuid         PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "order_id"     uuid         NOT NULL REFERENCES "pos_orders"("id"),
  "method"       text         NOT NULL DEFAULT 'cash',
  "amount_cents" integer      NOT NULL,
  "tip_cents"    integer      NOT NULL DEFAULT 0,
  "change_cents" integer      NOT NULL DEFAULT 0,
  "reference"    text,
  "created_at"   timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_pos_payments_order_id" ON "pos_payments"("order_id");
