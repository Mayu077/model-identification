"use server"

import { and, desc, eq, inArray, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { db } from "@/lib/db"
import { drivers, tripChangeRequests, trips } from "@/lib/db/schema"
import { writeAudit } from "@/lib/audit"
import { requireDriver, requireOwner } from "@/lib/tenant"

const tripIdSchema = z.number().int().positive()
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a real date")
const reasonSchema = z.string().trim().max(300).default("")

/**
 * A driver's own trips, and nothing else.
 *
 * The driver id comes from requireDriver(), which resolves it from the session
 * — it is never a parameter. There is deliberately no "all trips" variant on
 * this file: an accidental call cannot widen the scope because the scope is not
 * expressible here.
 */
export async function getMyTrips() {
  const driver = await requireDriver()
  const rows = await db
    .select()
    .from(trips)
    .where(and(eq(trips.organizationId, driver.organizationId), eq(trips.driverId, driver.driverId)))
    .orderBy(desc(trips.tripDate), desc(trips.id))
    .limit(200)
  if (rows.length === 0) return []

  // Attach whatever the driver has already asked for, so the UI can show
  // "waiting for the owner" instead of offering the same request twice.
  const pending = await db
    .select({ id: tripChangeRequests.id, tripId: tripChangeRequests.tripId, kind: tripChangeRequests.kind, requestedDate: tripChangeRequests.requestedDate, createdAt: tripChangeRequests.createdAt })
    .from(tripChangeRequests)
    .where(and(
      eq(tripChangeRequests.organizationId, driver.organizationId),
      eq(tripChangeRequests.driverId, driver.driverId),
      eq(tripChangeRequests.status, "pending"),
      inArray(tripChangeRequests.tripId, rows.map((row) => row.id)),
    ))
  const byTrip = new Map(pending.map((request) => [request.tripId, request]))
  return rows.map((row) => ({ ...row, pendingRequest: byTrip.get(row.id) ?? null }))
}

/** Confirms the trip is this driver's before any request is filed against it. */
async function ownTripOrThrow(organizationId: string, driverId: number, tripId: number) {
  const [trip] = await db
    .select({ id: trips.id, tripDate: trips.tripDate, containerNo: trips.containerNo })
    .from(trips)
    .where(and(eq(trips.id, tripId), eq(trips.organizationId, organizationId), eq(trips.driverId, driverId)))
    .limit(1)
  if (!trip) throw new Error("That trip is not one of yours")
  return trip
}

async function noPendingRequestOrThrow(organizationId: string, tripId: number) {
  const [existing] = await db
    .select({ id: tripChangeRequests.id })
    .from(tripChangeRequests)
    .where(and(eq(tripChangeRequests.organizationId, organizationId), eq(tripChangeRequests.tripId, tripId), eq(tripChangeRequests.status, "pending")))
    .limit(1)
  if (existing) throw new Error("The owner already has a request for this trip. Wait for their answer.")
}

/**
 * Drivers cannot change a trip's date themselves.
 *
 * The date decides which month's bill a trip lands on, so a quiet correction
 * after the fact moves money between invoices — the exact ambiguity the paper
 * process already suffers from. Raising a request keeps the correction possible
 * and leaves a record that it was asked for and by whom.
 */
export async function requestDateChange(tripId: number, requestedDate: string, reason: string) {
  const driver = await requireDriver()
  const id = tripIdSchema.parse(tripId)
  const date = isoDateSchema.parse(requestedDate)
  const why = reasonSchema.parse(reason ?? "")
  const trip = await ownTripOrThrow(driver.organizationId, driver.driverId, id)
  if (trip.tripDate === date) throw new Error("That is already the date on this trip")
  await noPendingRequestOrThrow(driver.organizationId, id)

  await db.insert(tripChangeRequests).values({
    organizationId: driver.organizationId,
    tripId: id,
    driverId: driver.driverId,
    requestedByUserId: driver.user.id,
    kind: "date_change",
    requestedDate: date,
    reason: why,
  })
  await writeAudit({
    organizationId: driver.organizationId,
    actorUserId: driver.user.id,
    action: "trip.date_change_requested",
    entityType: "trip",
    entityId: String(id),
    metadata: { from: trip.tripDate, to: date, containerNo: trip.containerNo },
  })
  revalidatePath("/driver")
  revalidatePath("/drivers")
}

/** Same reasoning as the date: a driver asks, the owner decides. */
export async function requestDelete(tripId: number, reason: string) {
  const driver = await requireDriver()
  const id = tripIdSchema.parse(tripId)
  const why = reasonSchema.parse(reason ?? "")
  const trip = await ownTripOrThrow(driver.organizationId, driver.driverId, id)
  await noPendingRequestOrThrow(driver.organizationId, id)

  await db.insert(tripChangeRequests).values({
    organizationId: driver.organizationId,
    tripId: id,
    driverId: driver.driverId,
    requestedByUserId: driver.user.id,
    kind: "delete",
    reason: why,
  })
  await writeAudit({
    organizationId: driver.organizationId,
    actorUserId: driver.user.id,
    action: "trip.delete_requested",
    entityType: "trip",
    entityId: String(id),
    metadata: { containerNo: trip.containerNo, tripDate: trip.tripDate },
  })
  revalidatePath("/driver")
  revalidatePath("/drivers")
}

/** Lets a driver take back a request the owner has not answered yet. */
export async function withdrawRequest(requestId: number) {
  const driver = await requireDriver()
  const id = tripIdSchema.parse(requestId)
  const deleted = await db
    .delete(tripChangeRequests)
    .where(and(
      eq(tripChangeRequests.id, id),
      eq(tripChangeRequests.organizationId, driver.organizationId),
      eq(tripChangeRequests.driverId, driver.driverId),
      eq(tripChangeRequests.status, "pending"),
    ))
    .returning({ id: tripChangeRequests.id })
  if (deleted.length === 0) throw new Error("That request is no longer open")
  revalidatePath("/driver")
  revalidatePath("/drivers")
}

// ---------------------------------------------------------------- owner side

export async function getChangeRequests() {
  const tenant = await requireOwner()
  return db
    .select({
      id: tripChangeRequests.id,
      kind: tripChangeRequests.kind,
      requestedDate: tripChangeRequests.requestedDate,
      reason: tripChangeRequests.reason,
      status: tripChangeRequests.status,
      createdAt: tripChangeRequests.createdAt,
      decidedAt: tripChangeRequests.decidedAt,
      driverName: drivers.name,
      tripId: trips.id,
      tripDate: trips.tripDate,
      containerNo: trips.containerNo,
      fromLocation: trips.fromLocation,
      toLocation: trips.toLocation,
      rate: trips.rate,
    })
    .from(tripChangeRequests)
    .innerJoin(trips, eq(tripChangeRequests.tripId, trips.id))
    .leftJoin(drivers, eq(tripChangeRequests.driverId, drivers.id))
    .where(eq(tripChangeRequests.organizationId, tenant.organizationId))
    // Pending first, then most recent — the queue is the point of this screen.
    .orderBy(sql`case when ${tripChangeRequests.status} = 'pending' then 0 else 1 end`, desc(tripChangeRequests.createdAt))
    .limit(100)
}

function isUniqueViolation(error: unknown): boolean {
  for (let e: unknown = error, depth = 0; e && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
    if (typeof e === "object" && e !== null && (e as { code?: unknown }).code === "23505") return true
  }
  return false
}

/**
 * The owner's answer. Approving a date change rewrites the trip; approving a
 * delete removes it.
 *
 * The request row is marked decided *before* the trip is touched, because
 * trip_change_requests.trip_id cascades on delete — approving a deletion takes
 * the request row with it. The audit entry is what survives, and it is written
 * here rather than left implicit for that reason.
 */
export async function decideChangeRequest(requestId: number, decision: "approved" | "rejected") {
  const tenant = await requireOwner()
  const id = tripIdSchema.parse(requestId)
  const verdict = z.enum(["approved", "rejected"]).parse(decision)

  const [request] = await db
    .select()
    .from(tripChangeRequests)
    .where(and(eq(tripChangeRequests.id, id), eq(tripChangeRequests.organizationId, tenant.organizationId), eq(tripChangeRequests.status, "pending")))
    .limit(1)
  if (!request) throw new Error("That request has already been answered")

  // Guarded on status so two taps, or two devices, cannot apply it twice.
  const [claimed] = await db
    .update(tripChangeRequests)
    .set({ status: verdict, decidedByUserId: tenant.user.id, decidedAt: new Date() })
    .where(and(eq(tripChangeRequests.id, id), eq(tripChangeRequests.status, "pending")))
    .returning({ id: tripChangeRequests.id })
  if (!claimed) throw new Error("That request has already been answered")

  if (verdict === "approved") {
    if (request.kind === "date_change" && request.requestedDate) {
      try {
        await db
          .update(trips)
          .set({ tripDate: request.requestedDate, updatedAt: new Date() })
          .where(and(eq(trips.id, request.tripId), eq(trips.organizationId, tenant.organizationId)))
      } catch (error) {
        // trips_unique_entry: the same container already has a trip on the
        // requested date. Put the request back so it is not silently lost.
        await db.update(tripChangeRequests).set({ status: "pending", decidedByUserId: null, decidedAt: null }).where(eq(tripChangeRequests.id, id))
        if (isUniqueViolation(error)) throw new Error("A trip for that container already exists on the requested date. Fix that one first.")
        throw error
      }
    } else if (request.kind === "delete") {
      await db.delete(trips).where(and(eq(trips.id, request.tripId), eq(trips.organizationId, tenant.organizationId)))
    }
  }

  await writeAudit({
    organizationId: tenant.organizationId,
    actorUserId: tenant.user.id,
    action: `trip.${request.kind}_${verdict}`,
    entityType: "trip",
    entityId: String(request.tripId),
    metadata: { requestId: id, requestedDate: request.requestedDate, reason: request.reason },
  })
  revalidatePath("/drivers")
  revalidatePath("/trips")
  revalidatePath("/driver")
  revalidatePath("/")
}
