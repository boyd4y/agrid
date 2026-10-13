ALTER TABLE "rows" ADD COLUMN IF NOT EXISTS "version" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rows_table_sort_id_idx" ON "rows" ("table_id","sort_order","id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rows_cells_gin_idx" ON "rows" USING gin ("cells");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "columns_table_sort_idx" ON "columns" ("table_id","sort_order");
