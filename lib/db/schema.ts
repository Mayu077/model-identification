import {
  date,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core"

export const trips = pgTable(
  "trips",
  {
    id: serial("id").primaryKey(),
    tripDate: date("trip_date").notNull(),
    containerNo: text("container_no").notNull(),
    size: text("size").notNull(), // '40' | '20'
    tripType: text("trip_type").notNull().default("single"), // 'single' | 'double'
    containerNo2: text("container_no_2"),
    fromLocation: text("from_location").notNull(),
    toLocation: text("to_location").notNull(),
    company: text("company").notNull(), // 'JWC' | 'JWR'
    direction: text("direction").notNull(), // 'EXPORT' | 'IMPORT'
    rate: integer("rate").notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique("trips_unique_entry").on(t.tripDate, t.containerNo)],
)

export const rates = pgTable(
  "rates",
  {
    id: serial("id").primaryKey(),
    company: text("company").notNull(),
    direction: text("direction").notNull(),
    tripKind: text("trip_kind").notNull(), // '40' | '20_single' | '20_double'
    rate: integer("rate").notNull(),
  },
  (t) => [unique("rates_unique").on(t.company, t.direction, t.tripKind)],
)

export const expenses = pgTable("expenses", {
  id: serial("id").primaryKey(),
  expenseDate: date("expense_date").notNull(),
  category: text("category").notNull(),
  amount: integer("amount").notNull(),
  description: text("description"),
  source: text("source").notNull().default("manual"), // 'manual' | 'ai_text' | 'ai_image'
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
})

export type Trip = typeof trips.$inferSelect
export type NewTrip = typeof trips.$inferInsert
export type Rate = typeof rates.$inferSelect
export type Expense = typeof expenses.$inferSelect
export type NewExpense = typeof expenses.$inferInsert
