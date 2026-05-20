ALTER TABLE "pos_orders" ADD COLUMN "source" text NOT NULL DEFAULT 'pos';
ALTER TABLE "pos_orders" ADD COLUMN "external_id" text;
CREATE INDEX "idx_pos_orders_external_id" ON "pos_orders"("external_id") WHERE "external_id" IS NOT NULL;
