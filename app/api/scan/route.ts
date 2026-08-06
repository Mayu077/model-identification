import { after } from "next/server"
import { and, eq } from "drizzle-orm"
import { createHash, randomUUID } from "node:crypto"
import { readImageSize } from "@/lib/image-size"
import { db } from "@/lib/db"
import { scanJobs, trips } from "@/lib/db/schema"
import { requireTenantApi } from "@/lib/tenant"
import { extractTripsFromImage, NoRowsExtracted } from "@/lib/ai/extract"
import { writeAudit } from "@/lib/audit"
import { isBlobConfigured, putTripCard } from "@/lib/blob"
import { retentionExpiryFrom } from "@/lib/retention"
import { imageRetentionDays } from "@/lib/retention.server"

// Extraction of a 40-row handwritten trip card runs in after(), after the
// response is sent, but maxDuration still bounds the whole invocation — at 60s
// the background work was being killed mid-extraction. Must stay above the AI
// router's TOTAL_BUDGET_MS (240s) so a failure is recorded on the job row
// rather than the function vanishing.
export const maxDuration = 300

// This route used requireTenant(), which calls redirect("/sign-in"). In a route
// handler that becomes a 307, and the browser's fetch() follows it to the HTML
// sign-in page, so the client received status 200 with HTML and failed to parse
// it — surfacing as the baffling "Scan failed (server error 200)". An API route
// must always answer with JSON, so use the throwing variant and map it here.
async function resolveTenant(): Promise<
  | { tenant: Awaited<ReturnType<typeof requireTenantApi>>; response?: undefined }
  | { tenant?: undefined; response: Response }
> {
  try {
    return { tenant: await requireTenantApi() }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized"
    return {
      response: Response.json(
        { error: message === "Unauthorized" ? "Your session expired — please sign in again." : message },
        { status: message === "Unauthorized" ? 401 : 403 },
      ),
    }
  }
}

/**
 * Store the uploaded card so the review UI can show each row's own strip of it.
 * Best-effort by design: if Blob is unreachable or unconfigured the scan must
 * still complete, just without the visual cross-check. Runs inside after(), so
 * the upload never adds latency to the POST the browser is waiting on.
 */
async function storeCardImage(id: string, organizationId: string, buffer: Buffer, contentType: string) {
  if (!isBlobConfigured()) return
  try {
    const imagePath = await putTripCard(organizationId, id, buffer, contentType)
    const days = await imageRetentionDays(organizationId)
    await db.update(scanJobs).set({ imagePath, imageExpiresAt: retentionExpiryFrom(days), updatedAt: new Date() }).where(and(eq(scanJobs.id, id), eq(scanJobs.organizationId, organizationId)))
  } catch (error) {
    console.log(`[scan] job ${id}: could not store card image:`, error instanceof Error ? error.message.slice(0, 200) : error)
  }
}

async function processJob(id: string, organizationId: string, dataUrl: string, buffer: Buffer, contentType: string) {
  try {
    await db.update(scanJobs).set({ status: "processing", attemptCount: 1, updatedAt: new Date(), leaseExpiresAt: new Date(Date.now() + 60_000) }).where(and(eq(scanJobs.id, id), eq(scanJobs.organizationId, organizationId)))
    // Upload alongside extraction rather than before it: the two are
    // independent, and extraction is the slow half of the budget.
    const [, extraction] = await Promise.all([
      storeCardImage(id, organizationId, buffer, contentType),
      extractTripsFromImage(dataUrl),
    ])
    const { trips: extracted, droppedRows, droppedBoxes } = extraction
    if (droppedRows > 0) console.log(`[scan] job ${id}: dropped ${droppedRows} unusable row(s)`)
    if (droppedBoxes > 0) console.log(`[scan] job ${id}: ${droppedBoxes} of ${extracted.length} row(s) had no usable position, crop preview hidden for those`)
    const existing = await db.select({ tripDate: trips.tripDate, containerNo: trips.containerNo }).from(trips).where(eq(trips.organizationId, organizationId))
    const duplicateSet = new Set(existing.map((trip) => `${trip.tripDate}|${trip.containerNo}`))
    const result = extracted.map((trip) => ({ ...trip, isDuplicate: duplicateSet.has(`${trip.tripDate}|${trip.containerNo}`) }))
    // input (the base64 copy) is still cleared here — the durable copy now lives
    // in Blob, and leaving megabytes of data URL in Postgres was pure waste.
    await db.update(scanJobs).set({ status: "succeeded", result: { trips: result }, input: {}, updatedAt: new Date(), completedAt: new Date(), leaseExpiresAt: null }).where(and(eq(scanJobs.id, id), eq(scanJobs.organizationId, organizationId)))
  } catch (error) {
    // A card nobody could read is a different thing from a crash, and the owner
    // needs different advice for each: one is "send a better photo", the other
    // is "try again". Keeping them apart also stops the review UI from blaming
    // the photo when the AI providers were simply all busy.
    const noRows = error instanceof NoRowsExtracted
    console.log(`[scan] job ${id} failed (${noRows ? "NO_ROWS_FOUND" : "EXTRACTION_FAILED"}):`, error instanceof Error ? error.message.slice(0, 300) : error)
    await db.update(scanJobs).set({ status: "failed", errorCode: noRows ? "NO_ROWS_FOUND" : "EXTRACTION_FAILED", errorMessage: error instanceof Error ? error.message.slice(0, 500) : "Extraction failed", input: {}, updatedAt: new Date(), completedAt: new Date(), leaseExpiresAt: null }).where(and(eq(scanJobs.id, id), eq(scanJobs.organizationId, organizationId)))
  }
}

export async function POST(req: Request) {
  const { tenant, response } = await resolveTenant()
  if (!tenant) return response
  const formData = await req.formData()
  const file = formData.get("image")
  if (!(file instanceof File)) return Response.json({ error: "No image provided" }, { status: 400 })
  if (file.size > 10 * 1024 * 1024) return Response.json({ error: "Image too large (max 10MB)" }, { status: 400 })
  const buffer = Buffer.from(await file.arrayBuffer())
  const idempotencyKey = createHash("sha256").update(buffer).digest("hex")
  const contentType = file.type || "image/jpeg"
  const dataUrl = `data:${contentType};base64,${buffer.toString("base64")}`
  const id = randomUUID()
  // Read the real dimensions from the bytes. sourceBox fractions are relative to
  // this image, so a wrong ratio would offset every row crop in the review UI.
  const size = readImageSize(buffer)
  const [job] = await db.insert(scanJobs).values({ id, organizationId: tenant.organizationId, createdByUserId: tenant.user.id, status: "queued", input: { dataUrl }, idempotencyKey, imageWidth: size?.width ?? null, imageHeight: size?.height ?? null }).onConflictDoNothing().returning()
  let selected = job ?? (await db.select().from(scanJobs).where(and(eq(scanJobs.organizationId, tenant.organizationId), eq(scanJobs.idempotencyKey, idempotencyKey))).limit(1))[0]
  // Re-uploading the same photo hashes to the same idempotency key, so a failed
  // job used to be handed back forever and every retry showed the identical old
  // error even once the cause was fixed. Reset a failed job and run it again;
  // succeeded/queued/processing jobs are still returned as-is (that is the
  // point of the key). Guarded on status = 'failed' so two concurrent retries
  // cannot both revive it.
  let revived = false
  if (!job && selected?.status === "failed") {
    // Dimensions are re-stamped here too. A job created before this route read
    // them kept null width/height forever through every retry, and without both
    // numbers the review UI cannot size a row crop and silently falls back to
    // its magnified mode.
    const [reset] = await db.update(scanJobs).set({ status: "queued", errorCode: null, errorMessage: null, result: null, completedAt: null, attemptCount: 0, imageWidth: size?.width ?? null, imageHeight: size?.height ?? null, updatedAt: new Date() }).where(and(eq(scanJobs.id, selected.id), eq(scanJobs.organizationId, tenant.organizationId), eq(scanJobs.status, "failed"))).returning()
    if (reset) {
      selected = reset
      revived = true
    }
  }
  if (job || revived) {
    await writeAudit({ organizationId: tenant.organizationId, actorUserId: tenant.user.id, action: "scan.queued", entityType: "scan_job", entityId: selected.id })
    const jobId = selected.id
    after(() => processJob(jobId, tenant.organizationId, dataUrl, buffer, contentType))
  }
  return Response.json({ jobId: selected.id, status: selected.status }, { status: job ? 202 : 200 })
}

export async function GET(req: Request) {
  const { tenant, response } = await resolveTenant()
  if (!tenant) return response
  const id = new URL(req.url).searchParams.get("id")
  if (!id) return Response.json({ error: "Job id required" }, { status: 400 })
  const [job] = await db.select({ id: scanJobs.id, status: scanJobs.status, result: scanJobs.result, errorMessage: scanJobs.errorMessage, imagePath: scanJobs.imagePath, imageWidth: scanJobs.imageWidth, imageHeight: scanJobs.imageHeight }).from(scanJobs).where(and(eq(scanJobs.id, id), eq(scanJobs.organizationId, tenant.organizationId))).limit(1)
  if (!job) return Response.json({ error: "Job not found" }, { status: 404 })
  // The blob pathname stays server-side; the client only needs to know whether
  // an image exists and its aspect ratio, then reads it via the proxy route.
  const { imagePath, ...rest } = job
  return Response.json({ ...rest, hasImage: Boolean(imagePath) })
}
