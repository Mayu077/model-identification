import { sql } from "drizzle-orm"
import { bigint, bigserial, boolean, check, date, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique } from "drizzle-orm/pg-core"

// Constraint names below are pinned to the ones already present in the live
// Neon database. v0 applied that schema directly without committing migrations,
// so these were reverse-engineered from it on 2026-07-29. Renaming any of them
// makes drizzle-kit emit a spurious drop/recreate against production.

export const user = pgTable("user", {
  id: text("id").primaryKey(), name: text("name").notNull(), email: text("email").notNull().unique("user_email_key"),
  emailVerified: boolean("emailVerified").notNull().default(false), image: text("image"),
  createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
})
export const session = pgTable("session", {
  id: text("id").primaryKey(), expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(), token: text("token").notNull().unique("session_token_key"),
  createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
  ipAddress: text("ipAddress"), userAgent: text("userAgent"), userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" }),
})
export const account = pgTable("account", {
  id: text("id").primaryKey(), accountId: text("accountId").notNull(), providerId: text("providerId").notNull(), userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("accessToken"), refreshToken: text("refreshToken"), idToken: text("idToken"), accessTokenExpiresAt: timestamp("accessTokenExpiresAt", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt", { withTimezone: true }), scope: text("scope"), password: text("password"),
  createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
})
export const verification = pgTable("verification", {
  id: text("id").primaryKey(), identifier: text("identifier").notNull(), value: text("value").notNull(), expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
})
export const organizations = pgTable("organizations", {
  id: text("id").primaryKey(), name: text("name").notNull(), slug: text("slug").notNull().unique("organizations_slug_key"), onboardingCompleted: boolean("onboarding_completed").notNull().default(false),
  isLegacy: boolean("is_legacy").notNull().default(false), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})
// memberships_user_id_key is UNIQUE on user_id: one person belongs to exactly
// one organization. That is the whole point for drivers — a driver login can
// never be pointed at another fleet's data, even by a bug.
export const memberships = pgTable("memberships", {
  id: bigserial("id", { mode: "number" }).primaryKey(), organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }), role: text("role").notNull().default("owner"), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("memberships_organization_id_user_id_key").on(t.organizationId, t.userId),
  unique("memberships_user_id_key").on(t.userId),
  check("memberships_role_check", sql`role = ANY (ARRAY['owner'::text, 'driver'::text])`),
])
export const ownerInvites = pgTable("owner_invites", {
  id: text("id").primaryKey(), organizationName: text("organization_name"), tokenHash: text("token_hash").notNull().unique("owner_invites_token_hash_key"), createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), consumedAt: timestamp("consumed_at", { withTimezone: true }), consumedByUserId: text("consumed_by_user_id").references(() => user.id, { onDelete: "set null" }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})
// trips_unique_entry is what makes onConflictDoNothing() in addTrips actually
// skip re-scanned cards. It is absent from the schema v0 built and was added in
// migration 0001.
export const trips = pgTable("trips", {
  id: bigserial("id", { mode: "number" }).primaryKey(), organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }), tripDate: date("trip_date").notNull(),
  containerNo: text("container_no").notNull(), size: text("size").notNull(), tripType: text("trip_type").notNull(), containerNo2: text("container_no_2"), fromLocation: text("from_location").notNull(),
  toLocation: text("to_location").notNull(), company: text("company").notNull(), direction: text("direction").notNull(), rate: integer("rate").notNull(), notes: text("notes"),
  // Provenance for the trip-check feature: which scanned card this row came off
  // and where on it. Both null for manual entries and for the legacy import.
  // ON DELETE SET NULL, not CASCADE — losing the card must never delete a trip.
  scanJobId: text("scan_job_id").references(() => scanJobs.id, { onDelete: "set null" }),
  sourceBox: jsonb("source_box"),
  // Which driver ran the trip. Set automatically when a driver submits it, and
  // it is what "a driver sees only their own trips" filters on. SET NULL rather
  // than CASCADE: removing a driver from the roster must not erase the work
  // they did, or the owner's own billing history disappears with them.
  driverId: bigint("driver_id", { mode: "number" }).references(() => drivers.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("trips_organization_id_id_key").on(t.id, t.organizationId),
  unique("trips_unique_entry").on(t.organizationId, t.tripDate, t.containerNo),
  check("trips_rate_check", sql`rate >= 0`),
  // Every load of the driver dashboard is this filter.
  index("trips_organization_id_driver_id_idx").on(t.organizationId, t.driverId),
])
export const expenses = pgTable("expenses", {
  id: bigserial("id", { mode: "number" }).primaryKey(), organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }), expenseDate: date("expense_date").notNull(),
  category: text("category").notNull(), amount: integer("amount").notNull(), description: text("description").notNull().default(""), source: text("source").notNull().default("manual"), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("expenses_organization_id_id_key").on(t.id, t.organizationId),
  check("expenses_amount_check", sql`amount >= 0`),
])
export const rates = pgTable("rates", {
  id: bigserial("id", { mode: "number" }).primaryKey(), organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  company: text("company").notNull(), direction: text("direction").notNull(), tripKind: text("trip_kind").notNull(), rate: integer("rate").notNull(),
}, (t) => [
  unique("rates_organization_id_company_direction_trip_kind_key").on(t.organizationId, t.company, t.direction, t.tripKind),
  check("rates_rate_check", sql`rate >= 0`),
])
export const settings = pgTable("settings", {
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }), key: text("key").notNull(), value: text("value").notNull(),
}, (t) => [primaryKey({ name: "settings_pkey", columns: [t.organizationId, t.key] })])
// Started as a contact list and is now also the roster of who can log in.
// A row with a null userId is still just a name and a phone number; giving that
// driver an account fills in userId and username without disturbing their trips.
export const drivers = pgTable("drivers", {
  id: bigserial("id", { mode: "number" }).primaryKey(), organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }), name: text("name").notNull(), mobile: text("mobile"), active: boolean("active").notNull().default(true),
  // The login account, if one was issued. SET NULL so deleting the auth user
  // leaves the roster entry (and its trips) intact rather than cascading.
  userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
  // What the driver actually types to sign in. Unique across the whole system,
  // not per organization, because the sign-in form asks for a username alone —
  // there is no org field to disambiguate, and asking for one on a phone at a
  // port gate is exactly the friction that gets a feature abandoned.
  username: text("username"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("drivers_user_id_key").on(t.userId),
  unique("drivers_username_key").on(t.username),
  unique("drivers_organization_id_id_key").on(t.organizationId, t.id),
])

// A driver may not change a trip's date or delete a trip outright — the date is
// what the bill is built from, and a silent correction after the fact is the
// exact failure the paper process already has. Both actions become a request
// here for the owner to accept or refuse, which also leaves a record that the
// disagreement happened.
export const tripChangeRequests = pgTable("trip_change_requests", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  tripId: bigint("trip_id", { mode: "number" }).notNull().references(() => trips.id, { onDelete: "cascade" }),
  driverId: bigint("driver_id", { mode: "number" }).references(() => drivers.id, { onDelete: "set null" }),
  requestedByUserId: text("requested_by_user_id").references(() => user.id, { onDelete: "set null" }),
  kind: text("kind").notNull(),
  // Only set for a date change; null for a delete request.
  requestedDate: date("requested_date"),
  reason: text("reason").notNull().default(""),
  status: text("status").notNull().default("pending"),
  decidedByUserId: text("decided_by_user_id").references(() => user.id, { onDelete: "set null" }),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("trip_change_requests_kind_check", sql`kind = ANY (ARRAY['date_change'::text, 'delete'::text])`),
  check("trip_change_requests_status_check", sql`status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])`),
  // A date change has to say what date; a delete must not carry one.
  check("trip_change_requests_date_check", sql`(kind = 'date_change') = (requested_date IS NOT NULL)`),
  // The owner's queue is "everything still pending in my org".
  index("trip_change_requests_organization_id_status_idx").on(t.organizationId, t.status),
])
export const auditLogs = pgTable("audit_logs", {
  id: bigserial("id", { mode: "number" }).primaryKey(), organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  actorUserId: text("actor_user_id"), action: text("action").notNull(), entityType: text("entity_type").notNull(), entityId: text("entity_id"), metadata: jsonb("metadata").notNull().default({}), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})
export const scanJobs = pgTable("scan_jobs", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }), createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
  status: text("status").notNull(), input: jsonb("input").notNull().default({}), result: jsonb("result"), errorCode: text("error_code"), errorMessage: text("error_message"), attemptCount: integer("attempt_count").notNull().default(0),
  idempotencyKey: text("idempotency_key").notNull(), leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(), completedAt: timestamp("completed_at", { withTimezone: true }),
  // Driver uploads stop at `uploaded`; only an owner can start extraction. These
  // fields keep the request context and attribution through the normal scan job.
  driverId: bigint("driver_id", { mode: "number" }).references(() => drivers.id, { onDelete: "set null" }),
  submittedByName: text("submitted_by_name"),
  documentType: text("document_type"),
  requestedTripDate: date("requested_trip_date"),
  requestNotes: text("request_notes"),
  reviewedByUserId: text("reviewed_by_user_id").references(() => user.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  // The uploaded card is kept in Vercel Blob (see lib/blob.ts) so the review UI
  // can show each row's own strip of the photo. `input` still holds the base64
  // only until extraction finishes, then it is cleared; imagePath outlives it.
  // Width/height are the compressed dimensions the model actually saw, which is
  // what sourceBox percentages are relative to.
  imagePath: text("image_path"), imageWidth: integer("image_width"), imageHeight: integer("image_height"),
  // Retention: purged by app/api/cron/purge-images. Null means "no image".
  imageExpiresAt: timestamp("image_expires_at", { withTimezone: true }),
}, (t) => [
  unique("scan_jobs_organization_id_idempotency_key_key").on(t.organizationId, t.idempotencyKey),
  check("scan_jobs_status_check", sql`status = ANY (ARRAY['uploaded'::text, 'queued'::text, 'processing'::text, 'succeeded'::text, 'failed'::text, 'completed'::text, 'rejected'::text])`),
  check("scan_jobs_document_type_check", sql`document_type IS NULL OR document_type = ANY (ARRAY['receipt'::text, 'trip_card'::text])`),
  index("scan_jobs_organization_id_status_created_at_idx").on(t.organizationId, t.status, t.createdAt),
  index("scan_jobs_organization_id_driver_id_created_at_idx").on(t.organizationId, t.driverId, t.createdAt),
])
// Bookkeeping for hand-written data migrations (e.g. scripts/import-legacy.mjs),
// separate from drizzle-kit's own __drizzle_migrations ledger.
export const schemaMigrations = pgTable("schema_migrations", {
  name: text("name").primaryKey(), checksum: text("checksum").notNull(),
  appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
})
export type Trip = typeof trips.$inferSelect
export type NewTrip = typeof trips.$inferInsert
export type Rate = typeof rates.$inferSelect
export type Driver = typeof drivers.$inferSelect
export type TripChangeRequest = typeof tripChangeRequests.$inferSelect
export type ScanJob = typeof scanJobs.$inferSelect
export type Expense = typeof expenses.$inferSelect
export type NewExpense = typeof expenses.$inferInsert
