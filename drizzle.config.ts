import { defineConfig } from "drizzle-kit"

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  // Neon's pooler (PgBouncer) does not support the session-level operations
  // drizzle-kit needs for DDL and introspection, so prefer the direct endpoint.
  dbCredentials: { url: (process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL)! },
  strict: true,
  verbose: true,
})
