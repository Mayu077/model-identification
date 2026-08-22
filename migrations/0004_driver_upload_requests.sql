DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scan_jobs_status_check' AND conrelid = 'scan_jobs'::regclass) THEN
    ALTER TABLE "scan_jobs" DROP CONSTRAINT "scan_jobs_status_check";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scan_jobs_created_by_user_id_user_id_fk') THEN
    ALTER TABLE "scan_jobs" DROP CONSTRAINT "scan_jobs_created_by_user_id_user_id_fk";
  ELSE
    ALTER TABLE "scan_jobs" DROP CONSTRAINT "scan_jobs_created_by_user_id_fkey";
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "scan_jobs" ALTER COLUMN "created_by_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "scan_jobs" ADD COLUMN "driver_id" bigint;--> statement-breakpoint
ALTER TABLE "scan_jobs" ADD COLUMN "submitted_by_name" text;--> statement-breakpoint
ALTER TABLE "scan_jobs" ADD COLUMN "document_type" text;--> statement-breakpoint
ALTER TABLE "scan_jobs" ADD COLUMN "requested_trip_date" date;--> statement-breakpoint
ALTER TABLE "scan_jobs" ADD COLUMN "request_notes" text;--> statement-breakpoint
ALTER TABLE "scan_jobs" ADD COLUMN "reviewed_by_user_id" text;--> statement-breakpoint
ALTER TABLE "scan_jobs" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "scan_jobs" ADD CONSTRAINT "scan_jobs_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_jobs" ADD CONSTRAINT "scan_jobs_reviewed_by_user_id_user_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_jobs" ADD CONSTRAINT "scan_jobs_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scan_jobs_organization_id_status_created_at_idx" ON "scan_jobs" USING btree ("organization_id","status","created_at");--> statement-breakpoint
CREATE INDEX "scan_jobs_organization_id_driver_id_created_at_idx" ON "scan_jobs" USING btree ("organization_id","driver_id","created_at");--> statement-breakpoint
ALTER TABLE "scan_jobs" ADD CONSTRAINT "scan_jobs_document_type_check" CHECK (document_type IS NULL OR document_type = ANY (ARRAY['receipt'::text, 'trip_card'::text]));--> statement-breakpoint
ALTER TABLE "scan_jobs" ADD CONSTRAINT "scan_jobs_status_check" CHECK (status = ANY (ARRAY['uploaded'::text, 'queued'::text, 'processing'::text, 'succeeded'::text, 'failed'::text, 'completed'::text, 'rejected'::text]));--> statement-breakpoint
WITH "target" AS (
  SELECT "id"
  FROM "organizations"
  WHERE "id" = 'legacy-rajeshri-enterprises' AND "is_legacy" = true
)
INSERT INTO "settings" ("organization_id", "key", "value")
SELECT "target"."id", "defaults"."key", "defaults"."value"
FROM "target"
CROSS JOIN (VALUES
  ('driver_salary_base', '15000'),
  ('driver_commission_40', '400'),
  ('driver_commission_20_single', '400'),
  ('driver_commission_20_double', '600')
) AS "defaults"("key", "value")
ON CONFLICT ("organization_id", "key") DO NOTHING;