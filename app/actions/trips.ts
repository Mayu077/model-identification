"use server"

import { db } from "@/lib/db"
import { rates, trips } from "@/lib/db/schema"
import { extractedTripSchema, normalizeContainerNo, tripKindOf, type ExtractedTrip } from "@/lib/domain"
import { writeAudit } from "@/lib/audit"
import { requireTenant } from "@/lib/tenant"
import { and, asc, between, desc, eq, inArray } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod"

// Postgres unique_violation. pg puts the code on the error, but drizzle wraps
// driver errors in DrizzleQueryError, so check the cause chain too.
function isUniqueViolation(error: unknown): boolean {
  for (let e: unknown = error, depth = 0; e && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
    if (typeof e === "object" && e !== null && (e as { code?: unknown }).code === "23505") return true
  }
  return false
}

export async function getRates() {
  const tenant = await requireTenant()
  return db.select().from(rates).where(eq(rates.organizationId, tenant.organizationId)).orderBy(asc(rates.company), asc(rates.direction), asc(rates.tripKind))
}

export async function updateRate(id: number, newRate: number) {
  const tenant = await requireTenant()
  const parsed = z.number().int().positive().max(1_000_000).parse(newRate)
  await db.update(rates).set({ rate: parsed }).where(and(eq(rates.id, id), eq(rates.organizationId, tenant.organizationId)))
  await writeAudit({ organizationId: tenant.organizationId, actorUserId: tenant.user.id, action: "rate.updated", entityType: "rate", entityId: String(id) })
  revalidatePath("/settings")
}

async function rateFor(organizationId: string, company: string, direction: string, size: string, tripType: string) {
  const [row] = await db.select().from(rates).where(and(eq(rates.organizationId, organizationId), eq(rates.company, company), eq(rates.direction, direction), eq(rates.tripKind, tripKindOf(size, tripType)))).limit(1)
  if (!row) throw new Error(`No rate configured for ${company} ${direction}`)
  return row.rate
}

export async function findDuplicates(entries: Array<{ tripDate: string; containerNo: string }>) {
  const tenant = await requireTenant()
  if (!entries.length) return []
  // Normalize to match what saveTrips will actually store, or the preview flags
  // the wrong rows as duplicates.
  const normalized = entries.map((entry) => ({ ...entry, containerNo: normalizeContainerNo(entry.containerNo) }))
  const existing = await db.select({ tripDate: trips.tripDate, containerNo: trips.containerNo }).from(trips).where(and(eq(trips.organizationId, tenant.organizationId), inArray(trips.containerNo, [...new Set(normalized.map((entry) => entry.containerNo))])))
  const keys = new Set(existing.map((entry) => `${entry.tripDate}|${entry.containerNo}`))
  return entries.filter((entry, i) => keys.has(`${normalized[i].tripDate}|${normalized[i].containerNo}`))
}

export interface SaveTripsResult { saved: number; skippedDuplicates: number; errors: string[] }
export async function saveTrips(rawEntries: ExtractedTrip[]): Promise<SaveTripsResult> {
  const tenant = await requireTenant()
  const result: SaveTripsResult = { saved: 0, skippedDuplicates: 0, errors: [] }
  for (const raw of rawEntries) {
    const parsed = extractedTripSchema.safeParse(raw)
    if (!parsed.success) { result.errors.push(`${raw.containerNo ?? "?"}: invalid data`); continue }
    const t = parsed.data
    // Normalize server-side too. saveTrips is a public server action, and
    // trips_unique_entry only dedupes if container numbers arrive in one form.
    const containerNo = normalizeContainerNo(t.containerNo)
    try {
      const rate = await rateFor(tenant.organizationId, t.company, t.direction, t.size, t.tripType)
      const inserted = await db.insert(trips).values({ organizationId: tenant.organizationId, tripDate: t.tripDate, containerNo, size: t.size, tripType: t.tripType, containerNo2: t.containerNo2 ? normalizeContainerNo(t.containerNo2) : null, fromLocation: t.fromLocation, toLocation: t.toLocation, company: t.company, direction: t.direction, rate }).onConflictDoNothing().returning({ id: trips.id })
      if (inserted.length) result.saved += 1
      else result.skippedDuplicates += 1
    } catch (error) { result.errors.push(`${t.containerNo}: ${error instanceof Error ? error.message : "unknown error"}`) }
  }
  await writeAudit({ organizationId: tenant.organizationId, actorUserId: tenant.user.id, action: "trips.imported", entityType: "trip", metadata: { savedCount: result.saved, skippedCount: result.skippedDuplicates } })
  revalidatePath("/trips"); revalidatePath("/")
  return result
}

export async function getTrips(from?: string, to?: string) {
  const tenant = await requireTenant()
  const filter = from && to ? and(eq(trips.organizationId, tenant.organizationId), between(trips.tripDate, from, to)) : eq(trips.organizationId, tenant.organizationId)
  return db.select().from(trips).where(filter).orderBy(desc(trips.tripDate), desc(trips.id)).limit(300)
}

const updateTripSchema = z.object({ tripDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), containerNo: z.string().min(4).max(15), size: z.enum(["40", "20"]), tripType: z.enum(["single", "double"]), containerNo2: z.string().nullable(), fromLocation: z.string().min(2).max(20), toLocation: z.string().min(2).max(20), company: z.enum(["JWC", "JWR"]), direction: z.enum(["EXPORT", "IMPORT"]) })
export async function updateTrip(id: number, data: z.infer<typeof updateTripSchema>) {
  const tenant = await requireTenant()
  const t = updateTripSchema.parse(data)
  const rate = await rateFor(tenant.organizationId, t.company, t.direction, t.size, t.tripType)
  try {
    await db.update(trips).set({ tripDate: t.tripDate, containerNo: normalizeContainerNo(t.containerNo), size: t.size, tripType: t.tripType, containerNo2: t.containerNo2 ? normalizeContainerNo(t.containerNo2) : null, fromLocation: t.fromLocation.toUpperCase(), toLocation: t.toLocation.toUpperCase(), company: t.company, direction: t.direction, rate, updatedAt: new Date() }).where(and(eq(trips.id, id), eq(trips.organizationId, tenant.organizationId)))
  } catch (error) {
    // trips_unique_entry. Before that constraint existed this edit silently
    // created a duplicate; now it fails, so give the reason rather than the SQL.
    if (isUniqueViolation(error)) throw new Error(`A trip for container ${normalizeContainerNo(t.containerNo)} on ${t.tripDate} already exists`)
    throw error
  }
  await writeAudit({ organizationId: tenant.organizationId, actorUserId: tenant.user.id, action: "trip.updated", entityType: "trip", entityId: String(id) })
  revalidatePath("/trips"); revalidatePath("/")
}
export async function deleteTrip(id: number) {
  const tenant = await requireTenant()
  await db.delete(trips).where(and(eq(trips.id, id), eq(trips.organizationId, tenant.organizationId)))
  await writeAudit({ organizationId: tenant.organizationId, actorUserId: tenant.user.id, action: "trip.deleted", entityType: "trip", entityId: String(id) })
  revalidatePath("/trips"); revalidatePath("/")
}
