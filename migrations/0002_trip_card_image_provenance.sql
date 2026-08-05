ALTER TABLE "scan_jobs" ADD COLUMN "image_path" text;--> statement-breakpoint
ALTER TABLE "scan_jobs" ADD COLUMN "image_width" integer;--> statement-breakpoint
ALTER TABLE "scan_jobs" ADD COLUMN "image_height" integer;--> statement-breakpoint
ALTER TABLE "scan_jobs" ADD COLUMN "image_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "scan_job_id" text;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "source_box" jsonb;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_scan_job_id_scan_jobs_id_fk" FOREIGN KEY ("scan_job_id") REFERENCES "public"."scan_jobs"("id") ON DELETE set null ON UPDATE no action;