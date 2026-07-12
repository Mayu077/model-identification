import { boolean, date, integer, jsonb, pgTable, serial, text, timestamp, unique, bigserial, index, primaryKey } from "drizzle-orm/pg-core"

export const user = pgTable("user", {
  id: text("id").primaryKey(), name: text("name").notNull(), email: text("email").notNull().unique(),
  emailVerified: boolean("emailVerified").notNull().default(false), image: text("image"),
  createdAt: timestamp("createdAt").notNull().defaultNow(), updatedAt: timestamp("updatedAt").notNull().defaultNow(),
})
export const session = pgTable("session", {
  id: text("id").primaryKey(), expiresAt: timestamp("expiresAt").notNull(), token: text("token").notNull().unique(),
  createdAt: timestamp("createdAt").notNull().defaultNow(), updatedAt: timestamp("updatedAt").notNull().defaultNow(),
  ipAddress: text("ipAddress"), userAgent: text("userAgent"), userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" }),
})
export const account = pgTable("account", {
  id: text("id").primaryKey(), accountId: text("accountId").notNull(), providerId: text("providerId").notNull(),
  userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" }), accessToken: text("accessToken"), refreshToken: text("refreshToken"),
  idToken: text("idToken"), accessTokenExpiresAt: timestamp("accessTokenExpiresAt"), refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt"),
  scope: text("scope"), password: text("password"), createdAt: timestamp("createdAt").notNull().defaultNow(), updatedAt: timestamp("updatedAt").notNull().defaultNow(),
})
export const verification = pgTable("verification", {
  id: text("id").primaryKey(), identifier: text("identifier").notNull(), value: text("value").notNull(), expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow(), updatedAt: timestamp("updatedAt").defaultNow(),
})

export const organizations = pgTable("organizations", {
  id: text("id").primaryKey(), name: text("name").notNull(), slug: text("slug").notNull().unique(),
  onboardingCompleted: boolean("onboarding_completed").notNull().default(false), isLegacy: boolean("is_legacy").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})
export const memberships = pgTable("memberships", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull(), userId: text("user_id").notNull(),
  role: text("role").notNull(), status: text("status").notNull().default("active"), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique("memberships_org_user_unique").on(t.organizationId, t.userId), index("memberships_user_idx").on(t.userId)])
export const ownerInvites = pgTable("owner_invites", {
  id: text("id").primaryKey(), codeHash: text("code_hash").notNull().unique(), label: text("label"), expiresAt: timestamp("expires_at", { withTimezone: true }),
  maxUses: integer("max_uses").notNull().default(1), useCount: integer("use_count").notNull().default(0), revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdByUserId: text("created_by_user_id"), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})
export const auditLogs = pgTable("audit_logs", {
  id: bigserial("id", { mode: "number" }).primaryKey(), organizationId: text("organization_id").notNull(), actorUserId: text("actor_user_id"),
  action: text("action").notNull(), entityType: text("entity_type").notNull(), entityId: text("entity_id"), metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("audit_logs_org_created_idx").on(t.organizationId, t.createdAt)])
export const drivers = pgTable("drivers", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull(), name: text("name").notNull(), phone: text("phone"),
  status: text("status").notNull().default("inactive"), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})
export const scanJobs = pgTable("scan_jobs", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull(), createdByUserId: text("created_by_user_id").notNull(), imageHash: text("image_hash").notNull(),
  status: text("status").notNull().default("pending"), workflowRunId: text("workflow_run_id"), result: jsonb("result"), errorCode: text("error_code"), errorMessage: text("error_message"),
  attemptCount: integer("attempt_count").notNull().default(0), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique("scan_jobs_org_hash_unique").on(t.organizationId, t.imageHash)])

export const trips = pgTable("trips", {
  id: serial("id").primaryKey(), organizationId: text("organization_id").notNull(), tripDate: date("trip_date").notNull(), containerNo: text("container_no").notNull(),
  size: text("size").notNull(), tripType: text("trip_type").notNull().default("single"), containerNo2: text("container_no_2"), fromLocation: text("from_location").notNull(),
  toLocation: text("to_location").notNull(), company: text("company").notNull(), direction: text("direction").notNull(), rate: integer("rate").notNull(), notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique("trips_org_unique_entry").on(t.organizationId, t.tripDate, t.containerNo), index("trips_org_date_idx").on(t.organizationId, t.tripDate)])
export const rates = pgTable("rates", {
  id: serial("id").primaryKey(), organizationId: text("organization_id").notNull(), company: text("company").notNull(), direction: text("direction").notNull(), tripKind: text("trip_kind").notNull(), rate: integer("rate").notNull(),
}, (t) => [unique("rates_org_unique").on(t.organizationId, t.company, t.direction, t.tripKind)])
export const expenses = pgTable("expenses", {
  id: serial("id").primaryKey(), organizationId: text("organization_id").notNull(), expenseDate: date("expense_date").notNull(), category: text("category").notNull(), amount: integer("amount").notNull(),
  description: text("description"), source: text("source").notNull().default("manual"), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("expenses_org_date_idx").on(t.organizationId, t.expenseDate)])
export const settings = pgTable("settings", {
  organizationId: text("organization_id").notNull(), key: text("key").notNull(), value: text("value").notNull(),
}, (t) => [primaryKey({ columns: [t.organizationId, t.key] })])

export type Trip = typeof trips.$inferSelect
export type NewTrip = typeof trips.$inferInsert
export type Rate = typeof rates.$inferSelect
export type Expense = typeof expenses.$inferSelect
export type NewExpense = typeof expenses.$inferInsert
