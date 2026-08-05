CREATE TABLE "trip_change_requests" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"trip_id" bigint NOT NULL,
	"driver_id" bigint,
	"requested_by_user_id" text,
	"kind" text NOT NULL,
	"requested_date" date,
	"reason" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by_user_id" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_change_requests_kind_check" CHECK (kind = ANY (ARRAY['date_change'::text, 'delete'::text])),
	CONSTRAINT "trip_change_requests_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])),
	CONSTRAINT "trip_change_requests_date_check" CHECK ((kind = 'date_change') = (requested_date IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "memberships" DROP CONSTRAINT "memberships_role_check";--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN "username" text;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "driver_id" bigint;--> statement-breakpoint
ALTER TABLE "trip_change_requests" ADD CONSTRAINT "trip_change_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_change_requests" ADD CONSTRAINT "trip_change_requests_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_change_requests" ADD CONSTRAINT "trip_change_requests_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_change_requests" ADD CONSTRAINT "trip_change_requests_requested_by_user_id_user_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_change_requests" ADD CONSTRAINT "trip_change_requests_decided_by_user_id_user_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trip_change_requests_organization_id_status_idx" ON "trip_change_requests" USING btree ("organization_id","status");--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trips_organization_id_driver_id_idx" ON "trips" USING btree ("organization_id","driver_id");--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_user_id_key" UNIQUE("user_id");--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_username_key" UNIQUE("username");--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_organization_id_id_key" UNIQUE("organization_id","id");--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_role_check" CHECK (role = ANY (ARRAY['owner'::text, 'driver'::text]));