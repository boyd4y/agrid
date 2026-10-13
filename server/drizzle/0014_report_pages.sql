ALTER TABLE "reports" ALTER COLUMN "table_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "reports" DROP CONSTRAINT "reports_table_id_fkey";
--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_table_id_fkey" FOREIGN KEY ("table_id") REFERENCES "tables"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "version" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
UPDATE "reports" SET "config" = jsonb_build_object(
  'description', '', 'columns', 2,
  'widgets', jsonb_build_array(jsonb_build_object(
    'id', "id"::text, 'type', 'chart', 'title', "name", 'width', 'full',
    'query', "config" || jsonb_build_object('tableId', "table_id")
  ))
) WHERE NOT ("config" ? 'widgets');
