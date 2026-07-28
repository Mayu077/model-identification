import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import pg from "pg"
import { read, utils } from "xlsx"

const { Pool } = pg
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const root = path.resolve(".v0/imports")
const files = fs.readdirSync(root).filter((name) => name.endsWith(".csv"))
const exports = files.map((name) => {
  const content = fs.readFileSync(path.join(root, name))
  const workbook = read(content, { type: "buffer", raw: false })
  return { name, rows: utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: null }) }
})
const classify = (rows) => rows[0] ? Object.keys(rows[0]).sort().join(",") : ""
const normalizeDate = (value) => {
  if (value == null || value === "") return null
  if (/^\d{5}(?:\.\d+)?$/.test(String(value))) {
    const date = new Date(Date.UTC(1899, 11, 30) + Number(value) * 86_400_000)
    return date.toISOString().slice(0, 10)
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid exported date: ${value}`)
  return date.toISOString().slice(0, 10)
}
const normalizeTimestamp = (value) => value == null || value === "" ? new Date().toISOString() : (/^\d{5}(?:\.\d+)?$/.test(String(value)) ? new Date(Date.UTC(1899, 11, 30) + Number(value) * 86_400_000).toISOString() : new Date(value).toISOString())
const legacyId = "legacy-rajeshri-enterprises"
const checksum = crypto.createHash("sha256").update(files.sort().map((f) => fs.readFileSync(path.join(root, f))).join("|")).digest("hex")
const client = await pool.connect()
try {
  await client.query("BEGIN")
  const migration = await client.query("SELECT checksum FROM schema_migrations WHERE name = $1", ["legacy-csv-import-v1"])
  if (migration.rowCount) {
    if (migration.rows[0].checksum !== checksum) throw new Error("Legacy import checksum mismatch")
    console.log("Legacy import already applied")
    await client.query("ROLLBACK")
    process.exit(0)
  }
  await client.query("INSERT INTO organizations (id,name,slug,onboarding_completed,is_legacy) VALUES ($1,$2,$3,true,true) ON CONFLICT (id) DO NOTHING", [legacyId, "Rajeshri Enterprises", "rajeshri-enterprises-legacy"])
  for (const entry of exports) {
    const kind = classify(entry.rows)
    for (const row of entry.rows) {
      if (kind.includes("trip_date")) await client.query(`INSERT INTO trips (id,organization_id,trip_date,container_no,size,trip_type,container_no_2,from_location,to_location,company,direction,rate,notes,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT DO NOTHING`, [row.id,legacyId,normalizeDate(row.trip_date),row.container_no,row.size,row.trip_type,row.container_no_2,row.from_location,row.to_location,row.company,row.direction,row.rate,row.notes,normalizeTimestamp(row.created_at),normalizeTimestamp(row.updated_at)])
      else if (kind.includes("trip_kind")) await client.query(`INSERT INTO rates (id,organization_id,company,direction,trip_kind,rate) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`, [row.id,legacyId,row.company,row.direction,row.trip_kind,row.rate])
      else if (kind.includes("expense_date")) await client.query(`INSERT INTO expenses (id,organization_id,expense_date,category,amount,description,source,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`, [row.id,legacyId,normalizeDate(row.expense_date),row.category,row.amount,row.description,row.source,normalizeTimestamp(row.created_at)])
      else if (kind === "key,organization_id,value") await client.query(`INSERT INTO settings (organization_id,key,value) VALUES ($1,$2,$3) ON CONFLICT (organization_id,key) DO UPDATE SET value = EXCLUDED.value`, [legacyId,row.key,row.value])
      else if (kind.includes("entity_type")) await client.query(`INSERT INTO audit_logs (organization_id,actor_user_id,action,entity_type,entity_id,metadata,created_at) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`, [legacyId,row.actor_user_id,row.action,row.entity_type,row.entity_id,row.metadata || "{}",normalizeTimestamp(row.created_at)])
    }
  }
  await client.query("SELECT setval(pg_get_serial_sequence('trips','id'), GREATEST(1, COALESCE((SELECT MAX(id) FROM trips),1)))")
  await client.query("SELECT setval(pg_get_serial_sequence('expenses','id'), GREATEST(1, COALESCE((SELECT MAX(id) FROM expenses),1)))")
  await client.query("SELECT setval(pg_get_serial_sequence('rates','id'), GREATEST(1, COALESCE((SELECT MAX(id) FROM rates),1)))")
  await client.query("INSERT INTO schema_migrations (name,checksum) VALUES ($1,$2)", ["legacy-csv-import-v1", checksum])
  await client.query("COMMIT")
  console.log("Legacy import complete")
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  client.release()
  await pool.end()
}
