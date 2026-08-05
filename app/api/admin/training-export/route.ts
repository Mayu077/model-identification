import { and, asc, eq, gt, inArray, isNotNull } from "drizzle-orm"
import { db } from "@/lib/db"
import { scanJobs, trips } from "@/lib/db/schema"
import { isPlatformOwner } from "@/lib/tenant"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"

// Streams, so the whole corpus is never held in memory, but a large export
// still needs longer than the default.
export const maxDuration = 300

const PAGE_SIZE = 200

/**
 * Training corpus for the planned self-hosted extraction model.
 *
 * Emits JSONL — one scan per line — pairing what the vision model produced with
 * what the owner actually saved after reviewing it. That pairing is the point:
 * the confirmed rows are human-corrected ground truth, which is the label you
 * want to fine-tune against, and the diff between the two is a ready-made list
 * of the mistakes the current provider makes.
 *
 * Image bytes are not inlined — the line carries the blob pathname and
 * scripts/export-training-images.mjs downloads them alongside the manifest.
 * Base64 in a JSONL would multiply the export size by roughly four for no gain.
 *
 * Restricted to the platform owner (BOOTSTRAP_OWNER_EMAIL): this deliberately
 * crosses tenant boundaries, so it is the one route that is not org-scoped.
 */
export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 })
  if (!isPlatformOwner(session.user.email)) {
    return Response.json({ error: "Not permitted" }, { status: 403 })
  }

  const encoder = new TextEncoder()
  // Keyset pagination on the primary key: stable even while new scans are being
  // written during a long export, and lets each pull fetch exactly one page so
  // a slow client applies real backpressure instead of buffering the corpus.
  let cursor = ""
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const batch = await db
          .select({
            id: scanJobs.id,
            organizationId: scanJobs.organizationId,
            createdAt: scanJobs.createdAt,
            result: scanJobs.result,
            imagePath: scanJobs.imagePath,
            imageWidth: scanJobs.imageWidth,
            imageHeight: scanJobs.imageHeight,
          })
          .from(scanJobs)
          .where(
            and(
              eq(scanJobs.status, "succeeded"),
              // No image means nothing to learn a mapping from.
              isNotNull(scanJobs.imagePath),
              cursor ? gt(scanJobs.id, cursor) : undefined,
            ),
          )
          .orderBy(asc(scanJobs.id))
          .limit(PAGE_SIZE)

        if (batch.length === 0) {
          controller.close()
          return
        }
        cursor = batch[batch.length - 1].id

        const confirmed = await db
          .select()
          .from(trips)
          .where(inArray(trips.scanJobId, batch.map((job) => job.id)))
        const confirmedByJob = new Map<string, typeof confirmed>()
        for (const trip of confirmed) {
          if (!trip.scanJobId) continue
          const list = confirmedByJob.get(trip.scanJobId) ?? []
          list.push(trip)
          confirmedByJob.set(trip.scanJobId, list)
        }

        for (const job of batch) {
          const extracted = (job.result as { trips?: unknown[] } | null)?.trips ?? []
          const line = {
            scanJobId: job.id,
            organizationId: job.organizationId,
            createdAt: job.createdAt,
            image: { path: job.imagePath, width: job.imageWidth, height: job.imageHeight },
            // What the provider returned, boxes included.
            extracted,
            // What the owner saved after review — the corrected labels.
            confirmed: (confirmedByJob.get(job.id) ?? []).map((trip) => ({
              tripDate: trip.tripDate,
              containerNo: trip.containerNo,
              size: trip.size,
              tripType: trip.tripType,
              containerNo2: trip.containerNo2,
              fromLocation: trip.fromLocation,
              toLocation: trip.toLocation,
              company: trip.company,
              direction: trip.direction,
              sourceBox: trip.sourceBox,
            })),
          }
          controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`))
        }

        // A short page means the table is exhausted.
        if (batch.length < PAGE_SIZE) controller.close()
      } catch (error) {
        controller.error(error)
      }
    },
  })

  const stamp = new Date().toISOString().slice(0, 10)
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Content-Disposition": `attachment; filename="fleetos-training-${stamp}.jsonl"`,
      "Cache-Control": "no-store",
    },
  })
}
