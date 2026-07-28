// Records a migration as already-applied in drizzle's ledger WITHOUT executing
// its SQL. Needed because v0 applied the schema directly to Neon and never
// committed migrations, so migrations/0000_baseline_live_schema.sql describes
// objects that already exist. Running it would fail on the first CREATE TABLE.
//
//   node scripts/baseline-ledger.mjs                        # baselines 0000
//   node scripts/baseline-ledger.mjs 0000_baseline_live_schema
//
// Safe to re-run: already-recorded migrations are skipped.
//
// drizzle-kit decides what to apply by comparing each journal entry's `when`
// against the newest created_at in the ledger. Recording 0000 with its exact
// journal timestamp therefore makes `pnpm db:migrate` start at 0001.

import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const migrationsDir = join(root, "migrations")

const connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL
if (!connectionString) {
  console.error("Set DATABASE_URL_UNPOOLED (preferred) or DATABASE_URL first.")
  process.exit(1)
}

const requested = process.argv.slice(2)
const tags = requested.length > 0 ? requested : ["0000_baseline_live_schema"]

const journal = JSON.parse(readFileSync(join(migrationsDir, "meta", "_journal.json"), "utf8"))

const entries = tags.map((tag) => {
  const entry = journal.entries.find((e) => e.tag === tag)
  if (!entry) {
    console.error(`No journal entry named "${tag}". Known tags: ${journal.entries.map((e) => e.tag).join(", ")}`)
    process.exit(1)
  }
  // Match drizzle's own hashing: sha256 over the raw file contents.
  const sql = readFileSync(join(migrationsDir, `${tag}.sql`), "utf8")
  return { tag, when: entry.when, hash: createHash("sha256").update(sql).digest("hex") }
})

const pool = new pg.Pool({ connectionString, max: 1 })
const client = await pool.connect().catch((error) => {
  console.error(`\nCould not connect: ${error.message}`)
  console.error("Check the connection string is the full Neon URL including ?sslmode=require")
  process.exit(1)
})

try {
  const host = new URL(connectionString).host
  console.log(`host      ${host}`)
  console.log(`database  ${new URL(connectionString).pathname.slice(1)}\n`)

  // Same DDL drizzle's migrator uses, so it adopts this table as its own.
  await client.query(`CREATE SCHEMA IF NOT EXISTS "drizzle"`)
  await client.query(
    `CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
       id SERIAL PRIMARY KEY,
       hash text NOT NULL,
       created_at bigint
     )`,
  )

  for (const { tag, when, hash } of entries) {
    const existing = await client.query(`SELECT hash, created_at FROM "drizzle"."__drizzle_migrations" WHERE created_at = $1`, [when])
    if (existing.rowCount > 0) {
      const match = existing.rows[0].hash === hash ? "hash matches" : `HASH DIFFERS (ledger ${existing.rows[0].hash.slice(0, 12)}…, file ${hash.slice(0, 12)}…)`
      console.log(`skip      ${tag} — already recorded, ${match}`)
      continue
    }
    await client.query(`INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at") VALUES ($1, $2)`, [hash, when])
    console.log(`recorded  ${tag} (created_at ${when}, hash ${hash.slice(0, 12)}…) — SQL NOT executed`)
  }

  const ledger = await client.query(`SELECT hash, created_at FROM "drizzle"."__drizzle_migrations" ORDER BY created_at`)
  console.log(`\nledger now holds ${ledger.rowCount} migration(s):`)
  for (const row of ledger.rows) {
    const entry = journal.entries.find((e) => String(e.when) === String(row.created_at))
    console.log(`  ${row.created_at}  ${entry ? entry.tag : "(not in journal)"}`)
  }
  const pending = journal.entries.filter((e) => !ledger.rows.some((r) => String(r.created_at) === String(e.when)))
  console.log(pending.length > 0 ? `\npending: ${pending.map((e) => e.tag).join(", ")} — run \`pnpm db:migrate\`` : "\nnothing pending")
} finally {
  client.release()
  await pool.end()
}
