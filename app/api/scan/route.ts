import { after } from "next/server"
import { and, eq, inArray } from "drizzle-orm"
import { createHash, randomUUID } from "node:crypto"
import { z } from "zod"
import { readImageSize } from "@/lib/image-size"
import { db } from "@/lib/db"
import { scanJobs, trips } from "@/lib/db/schema"
import { requireTenantApi } from "@/lib/tenant"
import { extractTripsFromImage, NoRowsExtracted } from "@/lib/ai/extract"
import { writeAudit } from "@/lib/audit"
import { getTripCard, isBlobConfigured, putTripCard } from "@/lib/blob"
import { retentionExpiryFrom } from "@/lib/retention"
import { imageRetentionDays } from "@/lib/retention.server"

export const maxDuration = 300

const uploadRequestSchema = z.object({
  documentType: z.enum(["receipt", "trip_card"]),
  requestedTripDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  notes: z.string().trim().max(500).default(""),
})

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

function validateImage(file: File): string | null {
  if (file.size > 10 * 1024 * 1024) return "Image too large (max 10MB)"
  if (!file.type.startsWith("image/")) return "Choose an image file"
  return null
}

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

async function processJob(
  id: string,
  organizationId: string,
  dataUrl: string,
  buffer: Buffer,
  contentType: string,
  options?: { storeImage?: boolean; documentType?: "receipt" | "trip_card" | null },
) {
  try {
    await db.update(scanJobs).set({ status: "processing", attemptCount: 1, updatedAt: new Date(), leaseExpiresAt: new Date(Date.now() + 300_000) }).where(and(eq(scanJobs.id, id), eq(scanJobs.organizationId, organizationId), eq(scanJobs.status, "queued")))
    const [, extraction] = await Promise.all([
      options?.storeImage === false ? Promise.resolve() : storeCardImage(id, organizationId, buffer, contentType),
      extractTripsFromImage(dataUrl, options?.documentType),
    ])
    const { trips: extracted, droppedRows, droppedBoxes, modelUsed, provider } = extraction
    if (droppedRows > 0) console.log(`[scan] job ${id}: dropped ${droppedRows} unusable row(s)`)
    if (droppedBoxes > 0) console.log(`[scan] job ${id}: ${droppedBoxes} of ${extracted.length} row(s) had no usable position`)
    const existing = await db.select({ tripDate: trips.tripDate, containerNo: trips.containerNo }).from(trips).where(eq(trips.organizationId, organizationId))
    const duplicateSet = new Set(existing.map((trip) => `${trip.tripDate}|${trip.containerNo}`))
    const result = extracted.map((trip) => ({ ...trip, isDuplicate: duplicateSet.has(`${trip.tripDate}|${trip.containerNo}`) }))
    await db.update(scanJobs).set({ status: "succeeded", result: { trips: result, modelUsed, provider }, input: {}, updatedAt: new Date(), completedAt: new Date(), leaseExpiresAt: null }).where(and(eq(scanJobs.id, id), eq(scanJobs.organizationId, organizationId)))
  } catch (error) {
    const noRows = error instanceof NoRowsExtracted
    console.log(`[scan] job ${id} failed (${noRows ? "NO_ROWS_FOUND" : "EXTRACTION_FAILED"}):`, error instanceof Error ? error.message.slice(0, 300) : error)
    await db.update(scanJobs).set({ status: "failed", errorCode: noRows ? "NO_ROWS_FOUND" : "EXTRACTION_FAILED", errorMessage: error instanceof Error ? error.message.slice(0, 500) : "Extraction failed", input: {}, updatedAt: new Date(), completedAt: new Date(), leaseExpiresAt: null }).where(and(eq(scanJobs.id, id), eq(scanJobs.organizationId, organizationId)))
  }
}

async function createDriverUpload(
  tenant: Awaited<ReturnType<typeof requireTenantApi>>,
  formData: FormData,
  file: File,
) {
  if (tenant.role !== "driver" || !tenant.driverId) return Response.json({ error: "Driver access required" }, { status: 403 })
  if (!isBlobConfigured()) return Response.json({ error: "Image storage is not configured. Ask the owner to contact support." }, { status: 503 })
  const parsed = uploadRequestSchema.safeParse({
    documentType: formData.get("documentType"),
    requestedTripDate: formData.get("requestedTripDate") ?? "",
    notes: formData.get("notes") ?? "",
  })
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid upload details" }, { status: 400 })

  const buffer = Buffer.from(await file.arrayBuffer())
  const size = readImageSize(buffer)
  if (!size) return Response.json({ error: "This image format could not be read. Upload a JPG, PNG, or WebP image." }, { status: 400 })
  const contentType = file.type || "image/jpeg"
  const idempotencyKey = createHash("sha256")
    .update(`driver-upload|${tenant.driverId}|${parsed.data.documentType}|${parsed.data.requestedTripDate}|${parsed.data.notes}|`)
    .update(buffer)
    .digest("hex")
  const id = randomUUID()
  const [job] = await db.insert(scanJobs).values({
    id,
    organizationId: tenant.organizationId,
    createdByUserId: tenant.user.id,
    status: "uploaded",
    input: {},
    idempotencyKey,
    imageWidth: size.width,
    imageHeight: size.height,
    driverId: tenant.driverId,
    submittedByName: tenant.user.name,
    documentType: parsed.data.documentType,
    requestedTripDate: parsed.data.requestedTripDate || null,
    requestNotes: parsed.data.notes || null,
  }).onConflictDoNothing().returning({ id: scanJobs.id, status: scanJobs.status })

  if (!job) {
    const [existing] = await db.select({ id: scanJobs.id, status: scanJobs.status }).from(scanJobs).where(and(eq(scanJobs.organizationId, tenant.organizationId), eq(scanJobs.idempotencyKey, idempotencyKey))).limit(1)
    return Response.json({ jobId: existing.id, status: existing.status, duplicate: true })
  }

  try {
    const imagePath = await putTripCard(tenant.organizationId, id, buffer, contentType)
    const days = await imageRetentionDays(tenant.organizationId)
    await db.update(scanJobs).set({ imagePath, imageExpiresAt: retentionExpiryFrom(days), updatedAt: new Date() }).where(eq(scanJobs.id, id))
  } catch (error) {
    await db.delete(scanJobs).where(and(eq(scanJobs.id, id), eq(scanJobs.organizationId, tenant.organizationId)))
    console.log(`[scan] driver upload ${id} failed:`, error instanceof Error ? error.message.slice(0, 200) : error)
    return Response.json({ error: "Could not store the image. Please try again." }, { status: 502 })
  }

  await writeAudit({ organizationId: tenant.organizationId, actorUserId: tenant.user.id, action: "scan.upload_requested", entityType: "scan_job", entityId: id, metadata: { driverId: tenant.driverId, documentType: parsed.data.documentType, requestedTripDate: parsed.data.requestedTripDate || null } })
  return Response.json({ jobId: id, status: "uploaded" }, { status: 201 })
}

async function startDriverUploadScan(
  tenant: Awaited<ReturnType<typeof requireTenantApi>>,
  requestJobId: string,
) {
  if (tenant.role !== "owner") return Response.json({ error: "Only the owner can scan driver uploads" }, { status: 403 })
  const id = z.string().uuid().parse(requestJobId)
  let [job] = await db.select().from(scanJobs).where(and(eq(scanJobs.id, id), eq(scanJobs.organizationId, tenant.organizationId))).limit(1)
  if (!job || !job.driverId) return Response.json({ error: "Upload request not found" }, { status: 404 })
  if (job.status === "succeeded") return Response.json({ jobId: job.id, status: job.status })
  if (["queued", "processing"].includes(job.status)) return Response.json({ jobId: job.id, status: job.status })
  if (!["uploaded", "failed"].includes(job.status)) return Response.json({ error: "This upload has already been handled" }, { status: 409 })
  if (!job.imagePath) return Response.json({ error: "The uploaded image is no longer available" }, { status: 410 })

  const blob = await getTripCard(job.imagePath)
  if (!blob || blob.statusCode !== 200) return Response.json({ error: "The uploaded image is no longer available" }, { status: 410 })
  const buffer = Buffer.from(await new Response(blob.stream).arrayBuffer())
  const contentType = blob.blob.contentType || "image/jpeg"
  const dataUrl = `data:${contentType};base64,${buffer.toString("base64")}`
  const [claimed] = await db.update(scanJobs).set({ status: "queued", errorCode: null, errorMessage: null, result: null, completedAt: null, attemptCount: 0, updatedAt: new Date() }).where(and(eq(scanJobs.id, id), eq(scanJobs.organizationId, tenant.organizationId), inArray(scanJobs.status, ["uploaded", "failed"]))).returning()
  if (!claimed) {
    ;[job] = await db.select().from(scanJobs).where(and(eq(scanJobs.id, id), eq(scanJobs.organizationId, tenant.organizationId))).limit(1)
    return Response.json({ jobId: id, status: job.status })
  }

  await writeAudit({ organizationId: tenant.organizationId, actorUserId: tenant.user.id, action: "scan.driver_upload_queued", entityType: "scan_job", entityId: id, metadata: { driverId: job.driverId, documentType: job.documentType } })
  after(() => processJob(id, tenant.organizationId, dataUrl, buffer, contentType, { storeImage: false, documentType: job.documentType as "receipt" | "trip_card" | null }))
  return Response.json({ jobId: id, status: "queued" }, { status: 202 })
}

export async function POST(req: Request) {
  const { tenant, response } = await resolveTenant()
  if (!tenant) return response
  const formData = await req.formData()
  const requestJobId = formData.get("requestJobId")
  if (typeof requestJobId === "string" && requestJobId) {
    try {
      return await startDriverUploadScan(tenant, requestJobId)
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "Could not start scan" }, { status: 400 })
    }
  }

  const file = formData.get("image")
  if (!(file instanceof File)) return Response.json({ error: "No image provided" }, { status: 400 })
  const imageError = validateImage(file)
  if (imageError) return Response.json({ error: imageError }, { status: 400 })
  if (tenant.role === "driver") return createDriverUpload(tenant, formData, file)
  if (tenant.role !== "owner") return Response.json({ error: "Owner access required" }, { status: 403 })

  const buffer = Buffer.from(await file.arrayBuffer())
  const idempotencyKey = createHash("sha256").update("owner-scan|").update(buffer).digest("hex")
  const contentType = file.type || "image/jpeg"
  const dataUrl = `data:${contentType};base64,${buffer.toString("base64")}`
  const id = randomUUID()
  const size = readImageSize(buffer)
  const [job] = await db.insert(scanJobs).values({ id, organizationId: tenant.organizationId, createdByUserId: tenant.user.id, status: "queued", input: { dataUrl }, idempotencyKey, imageWidth: size?.width ?? null, imageHeight: size?.height ?? null }).onConflictDoNothing().returning()
  let selected = job ?? (await db.select().from(scanJobs).where(and(eq(scanJobs.organizationId, tenant.organizationId), eq(scanJobs.idempotencyKey, idempotencyKey))).limit(1))[0]
  let revived = false
  if (!job && selected && ["failed", "completed"].includes(selected.status) && !selected.driverId) {
    const [reset] = await db.update(scanJobs).set({ status: "queued", errorCode: null, errorMessage: null, result: null, completedAt: null, attemptCount: 0, imageWidth: size?.width ?? null, imageHeight: size?.height ?? null, updatedAt: new Date() }).where(and(eq(scanJobs.id, selected.id), eq(scanJobs.organizationId, tenant.organizationId), inArray(scanJobs.status, ["failed", "completed"]))).returning()
    if (reset) { selected = reset; revived = true }
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
  const filters = [eq(scanJobs.id, id), eq(scanJobs.organizationId, tenant.organizationId)]
  if (tenant.role === "driver") {
    if (!tenant.driverId) return Response.json({ error: "Job not found" }, { status: 404 })
    filters.push(eq(scanJobs.driverId, tenant.driverId))
  }
  const [job] = await db.select({ id: scanJobs.id, status: scanJobs.status, result: scanJobs.result, errorMessage: scanJobs.errorMessage, imagePath: scanJobs.imagePath, imageWidth: scanJobs.imageWidth, imageHeight: scanJobs.imageHeight }).from(scanJobs).where(and(...filters)).limit(1)
  if (!job) return Response.json({ error: "Job not found" }, { status: 404 })
  const { imagePath, ...rest } = job
  return Response.json({ ...rest, hasImage: Boolean(imagePath) })
}
