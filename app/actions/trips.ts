"use server"

import { db } from "@/lib/db"
import { rates, trips } from "@/lib/db/schema"
import {
  extractedTripSchema,
  tripKindOf,
  type ExtractedTrip,
} from "@/lib/domain"
import { and, asc, between, desc, eq, inArray } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod"

export async function getRates() {
  return db.select().from(rates).orderBy(asc(rates.company), asc(rates.direction), asc(rates.tripKind))
}

export async function updateRate(id: number, newRate: number) {
  const parsed = z.number().int().positive().max(1_000_000).parse(newRate)
  await db.update(rates).set({ rate: parsed }).where(eq(rates.id, id))
  revalidatePath("/settings")
}

async function rateFor(
  company: string,
  direction: string,
  size: string,
  tripType: string,
): Promise<number> {
  const kind = tripKindOf(size, tripType)
  const rows = await db
    .select()
    .from(rates)
    .where(
      and(
        eq(rates.company, company),
        eq(rates.direction, direction),
        eq(rates.tripKind, kind),
      ),
    )
  if (rows.length === 0) throw new Error(`No rate configured for ${company} ${direction} ${kind}`)
  return rows[0].rate
}

/** Given extracted trips, return which (date, containerNo) already exist. */
export async function findDuplicates(
  entries: Array<{ tripDate: string; containerNo: string }>,
): Promise<Array<{ tripDate: string; containerNo: string }>> {
  if (entries.length === 0) return []
  const containerNos = [...new Set(entries.map((e) => e.containerNo))]
  const existing = await db
    .select({ tripDate: trips.tripDate, containerNo: trips.containerNo })
    .from(trips)
    .where(inArray(trips.containerNo, containerNos))
  const existingSet = new Set(existing.map((e) => `${e.tripDate}|${e.containerNo}`))
  return entries.filter((e) => existingSet.has(`${e.tripDate}|${e.containerNo}`))
}

export interface SaveTripsResult {
  saved: number
  skippedDuplicates: number
  errors: string[]
}

export async function saveTrips(
  rawEntries: ExtractedTrip[],
): Promise<SaveTripsResult> {
  const errors: string[] = []
  let saved = 0
  let skippedDuplicates = 0

  for (const raw of rawEntries) {
    // Re-validate on the server: never trust client/AI data blindly.
    const parsed = extractedTripSchema.safeParse(raw)
    if (!parsed.success) {
      errors.push(
        `${raw.containerNo ?? "?"}: invalid data (${parsed.error.issues[0]?.message})`,
      )
      continue
    }
    const t = parsed.data
    try {
      const rate = await rateFor(t.company, t.direction, t.size, t.tripType)
      const inserted = await db
        .insert(trips)
        .values({
          tripDate: t.tripDate,
          containerNo: t.containerNo,
          size: t.size,
          tripType: t.tripType,
          containerNo2: t.containerNo2 ?? null,
          fromLocation: t.fromLocation,
          toLocation: t.toLocation,
          company: t.company,
          direction: t.direction,
          rate,
        })
        .onConflictDoNothing({ target: [trips.tripDate, trips.containerNo] })
        .returning({ id: trips.id })
      if (inserted.length === 0) skippedDuplicates++
      else saved++
    } catch (err) {
      errors.push(
        `${t.containerNo}: ${err instanceof Error ? err.message : "unknown error"}`,
      )
    }
  }

  revalidatePath("/trips")
  revalidatePath("/")
  return { saved, skippedDuplicates, errors }
}

export async function getTrips(from?: string, to?: string) {
  if (from && to) {
    return db
      .select()
      .from(trips)
      .where(between(trips.tripDate, from, to))
      .orderBy(desc(trips.tripDate), desc(trips.id))
  }
  return db.select().from(trips).orderBy(desc(trips.tripDate), desc(trips.id)).limit(300)
}

const updateTripSchema = z.object({
  tripDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  containerNo: z.string().min(4).max(15),
  size: z.enum(["40", "20"]),
  tripType: z.enum(["single", "double"]),
  containerNo2: z.string().nullable(),
  fromLocation: z.string().min(2).max(20),
  toLocation: z.string().min(2).max(20),
  company: z.enum(["JWC", "JWR"]),
  direction: z.enum(["EXPORT", "IMPORT"]),
})

export async function updateTrip(
  id: number,
  data: z.infer<typeof updateTripSchema>,
) {
  const t = updateTripSchema.parse(data)
  const rate = await rateFor(t.company, t.direction, t.size, t.tripType)
  await db
    .update(trips)
    .set({
      tripDate: t.tripDate,
      containerNo: t.containerNo.toUpperCase(),
      size: t.size,
      tripType: t.tripType,
      containerNo2: t.containerNo2,
      fromLocation: t.fromLocation.toUpperCase(),
      toLocation: t.toLocation.toUpperCase(),
      company: t.company,
      direction: t.direction,
      rate,
      updatedAt: new Date(),
    })
    .where(eq(trips.id, id))
  revalidatePath("/trips")
  revalidatePath("/")
}

export async function deleteTrip(id: number) {
  await db.delete(trips).where(eq(trips.id, id))
  revalidatePath("/trips")
  revalidatePath("/")
}
