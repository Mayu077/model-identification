import { and, inArray, isNotNull, lt } from "drizzle-orm"
import { db } from "@/lib/db"
import { scanJobs } from "@/lib/db/schema"
import { deleteTripCards, isBlobConfigured } from "@/lib/blob"

// Deleting a few hundred blobs is network-bound, so give it room. Still far
// under the Fluid compute ceiling.
export const maxDuration = 120

// One batch per run. Vercel's Hobby plan fires crons once a day, and a business
// scanning a card or two a day will never approach this — the cap only matters
// for the first run after a long backlog, which simply clears over a few days.
const BATCH_SIZE = 500

/**
 * Deletes scanned trip-card images whose retention window has passed.
 *
 * Only the photo goes. The trip rows keep their numbers, their audit trail and
 * their source_box, so the ledger stays complete — what is lost is the ability
 * to re-check that entry against the original handwriting. That is the trade the
 * retention setting exists to make (see lib/retention.ts).
 */
export async function GET(req: Request) {
  // Vercel signs cron invocations with CRON_SECRET. Without the env var set
  // there is nothing to verify against, so refuse rather than run unauthenticated
  // — this endpoint deletes data.
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return Response.json({ error: "CRON_SECRET is not configured" }, { status: 503 })
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (!isBlobConfigured()) {
    return Response.json({ error: "Blob storage is not configured" }, { status: 503 })
  }

  const expired = await db
    .select({ id: scanJobs.id, imagePath: scanJobs.imagePath })
    .from(scanJobs)
    // A null image_expires_at means retention is disabled for that org, so those
    // rows are skipped rather than treated as already-due.
    .where(and(isNotNull(scanJobs.imagePath), isNotNull(scanJobs.imageExpiresAt), lt(scanJobs.imageExpiresAt, new Date())))
    .limit(BATCH_SIZE)

  if (expired.length === 0) return Response.json({ purged: 0, remaining: false })

  const paths = expired.map((row) => row.imagePath).filter((p): p is string => Boolean(p))
  try {
    await deleteTripCards(paths)
  } catch (error) {
    // Clearing the DB pointer anyway would orphan the blobs — they would keep
    // billing with nothing left referencing them. Leave the rows for the next
    // run instead and report the failure.
    return Response.json(
      { error: "Blob deletion failed", detail: error instanceof Error ? error.message.slice(0, 200) : "unknown" },
      { status: 502 },
    )
  }

  await db
    .update(scanJobs)
    .set({ imagePath: null, imageExpiresAt: null, updatedAt: new Date() })
    .where(inArray(scanJobs.id, expired.map((row) => row.id)))

  return Response.json({ purged: expired.length, remaining: expired.length === BATCH_SIZE })
}
