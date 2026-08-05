import { and, eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { scanJobs } from "@/lib/db/schema"
import { requireTenantApi } from "@/lib/tenant"
import { getTripCard } from "@/lib/blob"

/**
 * Serves a scanned trip card to the review UI.
 *
 * The Blob store is private, so the only way to read the bytes is with the
 * server's read-write token. That makes this route the single gate, and it
 * checks org membership before reading: the blob pathname is never sent to the
 * browser, so knowing a job id gets you nothing without a session in that org.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  let organizationId: string
  try {
    ;({ organizationId } = await requireTenantApi())
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized"
    return Response.json({ error: message }, { status: message === "Unauthorized" ? 401 : 403 })
  }

  const { jobId } = await params
  const [job] = await db
    .select({ imagePath: scanJobs.imagePath })
    .from(scanJobs)
    // Scoped by organization, so a job id from another tenant reads as missing.
    .where(and(eq(scanJobs.id, jobId), eq(scanJobs.organizationId, organizationId)))
    .limit(1)
  if (!job?.imagePath) return Response.json({ error: "No image for this scan" }, { status: 404 })

  const blob = await getTripCard(job.imagePath)
  // Null once retention has purged the image, which is expected, not an error.
  if (!blob || blob.statusCode !== 200) {
    return Response.json({ error: "Image is no longer available" }, { status: 404 })
  }

  return new Response(blob.stream, {
    headers: {
      "Content-Type": blob.blob.contentType,
      "Content-Length": String(blob.blob.size),
      // Private: the response is tied to one org's session, so it must never be
      // held by a shared cache. immutable because the object never changes once
      // written — the browser can reuse it across all 40 row crops on a card.
      "Cache-Control": "private, max-age=3600, immutable",
      "Content-Disposition": "inline",
    },
  })
}
