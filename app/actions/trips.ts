"use server"

import { db } from "@/lib/db"
import { rates, scanJobs, trips } from "@/lib/db/schema"
import { extractedTripSchema, normalizeContainerNo, tripKindOf, type ExtractedTrip } from "@/lib/domain"
import { writeAudit } from "@/lib/audit"
import { requireOwner, requireTenant } from "@/lib/tenant"
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
  const tenant = await requireOwner()
  return db.select().from(rates).where(eq(rates.organizationId, tenant.organizationId)).orderBy(asc(rates.company), asc(rates.direction), asc(rates.tripKind))
}

export async function updateRate(id: number, newRate: number) {
  const tenant = await requireOwner()
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

// Provenance sent by the scan review UI: which stored card the row came off and
// the vertical band it occupied. Validated rather than trusted — this is a
// public server action, and the values end up driving an image crop.
const sourceBoxSchema = z.object({ top: z.number().min(0).max(1), bottom: z.number().min(0).max(1) })
  .refine((box) => box.top < box.bottom, "box top must be above bottom")
const tripProvenanceSchema = z.object({
  scanJobId: z.string().min(1).max(64).nullable().optional(),
  sourceBox: sourceBoxSchema.nullable().optional(),
})
export type SaveTripInput = ExtractedTrip & z.infer<typeof tripProvenanceSchema>

export interface SaveTripsResult { saved: number; skippedDuplicates: number; errors: string[] }
export async function saveTrips(rawEntries: SaveTripInput[]): Promise<SaveTripsResult> {
  // Drivers submit images only. The owner reviews and saves the extracted rows,
  // while attribution comes from the server-owned scan job rather than a client
  // field, so one driver can never file work under another driver's name.
  const tenant = await requireOwner()
  const result: SaveTripsResult = { saved: 0, skippedDuplicates: 0, errors: [] }
  const claimedJobIds = [...new Set(rawEntries.map((e) => e.scanJobId).filter((id): id is string => typeof id === "string" && id.length > 0))]
  const ownedJobs = new Map(
    (claimedJobIds.length === 0
      ? []
      : await db.select({ id: scanJobs.id, driverId: scanJobs.driverId, requestNotes: scanJobs.requestNotes, status: scanJobs.status }).from(scanJobs).where(and(eq(scanJobs.organizationId, tenant.organizationId), inArray(scanJobs.id, claimedJobIds)))
    ).map((job) => [job.id, job]),
  )
  for (const raw of rawEntries) {
    const parsed = extractedTripSchema.safeParse(raw)
    if (!parsed.success) { result.errors.push(`${raw.containerNo ?? "?"}: invalid data`); continue }
    const t = parsed.data
    const provenance = tripProvenanceSchema.safeParse(raw)
    const claimedJob = provenance.success && provenance.data.scanJobId ? ownedJobs.get(provenance.data.scanJobId) : null
    const scanJobId = claimedJob?.status === "succeeded" ? claimedJob.id : null
    // A box is only meaningful next to a successfully reviewed scan.
    const sourceBox = scanJobId && provenance.success ? (provenance.data.sourceBox ?? null) : null
    const driverId = scanJobId ? (claimedJob?.driverId ?? null) : null
    const notes = scanJobId ? (claimedJob?.requestNotes ?? null) : null
    // Normalize server-side too. saveTrips is a public server action, and
    // trips_unique_entry only dedupes if container numbers arrive in one form.
    const containerNo = normalizeContainerNo(t.containerNo)
    try {
      const rate = await rateFor(tenant.organizationId, t.company, t.direction, t.size, t.tripType)
      const inserted = await db.insert(trips).values({ organizationId: tenant.organizationId, tripDate: t.tripDate, containerNo, size: t.size, tripType: t.tripType, containerNo2: t.containerNo2 ? normalizeContainerNo(t.containerNo2) : null, fromLocation: t.fromLocation, toLocation: t.toLocation, company: t.company, direction: t.direction, rate, notes, scanJobId, sourceBox, driverId }).onConflictDoNothing().returning({ id: trips.id })
      if (inserted.length) result.saved += 1
      else result.skippedDuplicates += 1
    } catch (error) { result.errors.push(`${t.containerNo}: ${error instanceof Error ? error.message : "unknown error"}`) }
  }
  if (result.errors.length === 0 && claimedJobIds.length > 0) {
    await db.update(scanJobs).set({ status: "completed", reviewedByUserId: tenant.user.id, reviewedAt: new Date(), updatedAt: new Date() }).where(and(eq(scanJobs.organizationId, tenant.organizationId), eq(scanJobs.status, "succeeded"), inArray(scanJobs.id, claimedJobIds)))
  }
  await writeAudit({ organizationId: tenant.organizationId, actorUserId: tenant.user.id, action: "trips.imported", entityType: "trip", metadata: { savedCount: result.saved, skippedCount: result.skippedDuplicates, scanJobIds: claimedJobIds } })
  revalidatePath("/trips"); revalidatePath("/"); revalidatePath("/scan"); revalidatePath("/driver"); revalidatePath("/driver/upload")
  return result
}

export async function getTrips(from?: string, to?: string) {
  // Whole-fleet view. Drivers read their own trips through getMyTrips in
  // app/actions/driver-trips.ts, which cannot return anyone else's.
  const tenant = await requireOwner()
  const filter = from && to ? and(eq(trips.organizationId, tenant.organizationId), between(trips.tripDate, from, to)) : eq(trips.organizationId, tenant.organizationId)
  return db.select().from(trips).where(filter).orderBy(desc(trips.tripDate), desc(trips.id)).limit(300)
}

const updateTripSchema = z.object({ tripDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), containerNo: z.string().min(4).max(15), size: z.enum(["40", "20"]), tripType: z.enum(["single", "double"]), containerNo2: z.string().nullable(), fromLocation: z.string().min(2).max(20), toLocation: z.string().min(2).max(20), company: z.enum(["JWC", "JWR"]), direction: z.enum(["EXPORT", "IMPORT"]) })
export async function updateTrip(id: number, data: z.infer<typeof updateTripSchema>) {
  // Owner-only. A driver correcting a trip raises a request instead — see
  // app/actions/driver-trips.ts.
  const tenant = await requireOwner()
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
  const tenant = await requireOwner()
  await db.delete(trips).where(and(eq(trips.id, id), eq(trips.organizationId, tenant.organizationId)))
  await writeAudit({ organizationId: tenant.organizationId, actorUserId: tenant.user.id, action: "trip.deleted", entityType: "trip", entityId: String(id) })
  revalidatePath("/trips"); revalidatePath("/")
}
