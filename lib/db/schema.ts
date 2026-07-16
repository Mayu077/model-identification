import { bigint, bigserial, boolean, date, integer, jsonb, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core"

export const user = pgTable("user", {
  id: text("id").primaryKey(), name: text("name").notNull(), email: text("email").notNull().unique(),
  emailVerified: boolean("emailVerified").notNull().default(false), image: text("image"),
  createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
})
export const session = pgTable("session", {
  id: text("id").primaryKey(), expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(), token: text("token").notNull().unique(),
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
  id: text("id").primaryKey(), name: text("name").notNull(), slug: text("slug").notNull().unique(), onboardingCompleted: boolean("onboarding_completed").notNull().default(false),
  isLegacy: boolean("is_legacy").notNull().default(false), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})
export const memberships = pgTable("memberships", {
  id: bigserial("id", { mode: "number" }).primaryKey(), organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }), role: text("role").notNull().default("owner"), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique().on(t.organizationId, t.userId), unique().on(t.userId)])
export const ownerInvites = pgTable("owner_invites", {
  id: text("id").primaryKey(), organizationName: text("organization_name"), tokenHash: text("token_hash").notNull().unique(), createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), consumedAt: timestamp("consumed_at", { withTimezone: true }), consumedByUserId: text("consumed_by_user_id").references(() => user.id, { onDelete: "set null" }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})
export const trips = pgTable("trips", {
  id: bigserial("id", { mode: "number" }).primaryKey(), organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }), tripDate: date("trip_date").notNull(),
  containerNo: text("container_no").notNull(), size: text("size").notNull(), tripType: text("trip_type").notNull(), containerNo2: text("container_no_2"), fromLocation: text("from_location").notNull(),
  toLocation: text("to_location").notNull(), company: text("company").notNull(), direction: text("direction").notNull(), rate: integer("rate").notNull(), notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique().on(t.organizationId, t.tripDate, t.containerNo)])
export const expenses = pgTable("expenses", {
  id: bigserial("id", { mode: "number" }).primaryKey(), organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }), expenseDate: date("expense_date").notNull(),
  category: text("category").notNull(), amount: integer("amount").notNull(), description: text("description").notNull().default(""), source: text("source").notNull().default("manual"), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})
export const rates = pgTable("rates", {
  id: bigserial("id", { mode: "number" }).primaryKey(), organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  company: text("company").notNull(), direction: text("direction").notNull(), tripKind: text("trip_kind").notNull(), rate: integer("rate").notNull(),
}, (t) => [unique().on(t.organizationId, t.company, t.direction, t.tripKind)])
export const settings = pgTable("settings", {
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }), key: text("key").notNull(), value: text("value").notNull(),
}, (t) => [unique().on(t.organizationId, t.key)])
export const drivers = pgTable("drivers", {
  id: bigserial("id", { mode: "number" }).primaryKey(), organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }), name: text("name").notNull(), mobile: text("mobile"), active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})
export const auditLogs = pgTable("audit_logs", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(), organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  actorUserId: text("actor_user_id"), action: text("action").notNull(), entityType: text("entity_type").notNull(), entityId: text("entity_id"), metadata: jsonb("metadata").notNull().default({}), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})
export const scanJobs = pgTable("scan_jobs", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }), createdByUserId: text("created_by_user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  status: text("status").notNull(), input: jsonb("input").notNull().default({}), result: jsonb("result"), errorCode: text("error_code"), errorMessage: text("error_message"), attemptCount: integer("attempt_count").notNull().default(0),
  idempotencyKey: text("idempotency_key").notNull(), leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(), completedAt: timestamp("completed_at", { withTimezone: true }),
}, (t) => [unique().on(t.organizationId, t.idempotencyKey)])
export type Trip = typeof trips.$inferSelect
export type NewTrip = typeof trips.$inferInsert
export type Rate = typeof rates.$inferSelect
export type Expense = typeof expenses.$inferSelect
export type NewExpense = typeof expenses.$inferInsert
