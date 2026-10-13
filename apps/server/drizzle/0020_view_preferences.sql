ALTER TABLE "table_views" ADD COLUMN "is_default" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY table_id ORDER BY sort_order, created_at, id) AS position
  FROM table_views
)
UPDATE table_views SET is_default = true FROM ranked WHERE table_views.id = ranked.id AND ranked.position = 1;
--> statement-breakpoint
CREATE UNIQUE INDEX "table_views_one_default_idx" ON "table_views" ("table_id") WHERE "is_default" = true;
