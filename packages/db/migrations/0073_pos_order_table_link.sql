ALTER TABLE "pos_orders" ADD COLUMN "table_id" uuid REFERENCES "pos_tables"("id") ON DELETE SET NULL;
CREATE INDEX "idx_pos_orders_table" ON "pos_orders"("table_id") WHERE "table_id" IS NOT NULL;
