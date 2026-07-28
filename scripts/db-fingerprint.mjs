// Read-only probe to identify which Neon database a DATABASE_URL points at,
// and which schema generation it is on. Writes nothing.
//
//   DATABASE_URL="postgresql://..." node scripts/db-fingerprint.mjs
//
// Safe to paste the output into a chat: it prints no password. The host line is
// the only identifying value; redact it if you prefer.

import pg from "pg"

const { Pool } = pg
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set")
  process.exit(1)
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })

const scalar = async (client, sql) => {
  try {
    const { rows } = await client.query(sql)
    return rows[0] ? Object.values(rows[0])[0] : null
  } catch {
    return "—" // table absent
  }
}

const client = await pool.connect().catch((error) => {
  console.error(`\nCould not connect: ${error.message}`)
  console.error("Check the connection string is the full Neon URL including ?sslmode=require")
  process.exit(1)
})
try {
  const url = new URL(process.env.DATABASE_URL)
  console.log(`host      ${url.hostname}`)
  console.log(`database  ${url.pathname.slice(1)}`)

  const { rows: tables } = await client.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name",
  )
  const names = tables.map((t) => t.table_name)
  console.log(`tables    ${names.length}: ${names.join(", ") || "(none)"}`)

  const isMultiTenant = names.includes("organizations")
  const hasOrgCol = await scalar(
    client,
    "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='trips' AND column_name='organization_id'",
  )
  console.log(
    `generation ${isMultiTenant && hasOrgCol > 0 ? "NEW (multi-tenant, post-cutover)" : names.length === 0 ? "EMPTY" : "OLD (pre-auth, no organization_id)"}`,
  )

  console.log("\nrow counts")
  for (const t of ["organizations", "user", "memberships", "trips", "rates", "expenses", "settings", "drivers", "audit_logs", "scan_jobs"]) {
    console.log(`  ${t.padEnd(14)} ${await scalar(client, `SELECT count(*) FROM "${t}"`)}`)
  }

  console.log("\nfreshness")
  console.log(`  newest trip created_at    ${await scalar(client, "SELECT max(created_at) FROM trips")}`)
  console.log(`  newest trip trip_date     ${await scalar(client, "SELECT max(trip_date) FROM trips")}`)
  console.log(`  newest expense created_at ${await scalar(client, "SELECT max(created_at) FROM expenses")}`)
  console.log(`  newest audit created_at   ${await scalar(client, "SELECT max(created_at) FROM audit_logs")}`)
  console.log(`  newest user createdAt     ${await scalar(client, 'SELECT max("createdAt") FROM "user"')}`)

  console.log("\nmigration ledger")
  console.log(`  schema_migrations   ${await scalar(client, "SELECT string_agg(name, ', ') FROM schema_migrations")}`)
  console.log(`  drizzle applied     ${await scalar(client, 'SELECT count(*) FROM "drizzle"."__drizzle_migrations"')}`)

  const orgs = await client
    .query("SELECT id, name, slug, is_legacy, onboarding_completed FROM organizations ORDER BY created_at")
    .catch(() => ({ rows: [] }))
  if (orgs.rows.length) {
    console.log("\norganizations")
    for (const o of orgs.rows) console.log(`  ${o.id}  ${o.name}  legacy=${o.is_legacy}  onboarded=${o.onboarding_completed}`)
  }
} finally {
  client.release()
  await pool.end()
}
