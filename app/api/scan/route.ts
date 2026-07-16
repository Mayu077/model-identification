import { after } from "next/server"
import { and, eq } from "drizzle-orm"
import { createHash, randomUUID } from "node:crypto"
import { db } from "@/lib/db"
import { scanJobs, trips } from "@/lib/db/schema"
import { requireTenant } from "@/lib/tenant"
import { extractTripsFromImage } from "@/lib/ai/extract"
import { writeAudit } from "@/lib/audit"

export const maxDuration = 60

async function processJob(id: string, organizationId: string, dataUrl: string) {
  try {
    await db.update(scanJobs).set({ status: "processing", attemptCount: 1, updatedAt: new Date(), leaseExpiresAt: new Date(Date.now() + 60_000) }).where(and(eq(scanJobs.id, id), eq(scanJobs.organizationId, organizationId)))
    const { trips: extracted } = await extractTripsFromImage(dataUrl)
    const existing = await db.select({ tripDate: trips.tripDate, containerNo: trips.containerNo }).from(trips).where(eq(trips.organizationId, organizationId))
    const duplicateSet = new Set(existing.map((trip) => `${trip.tripDate}|${trip.containerNo}`))
    const result = extracted.map((trip) => ({ ...trip, isDuplicate: duplicateSet.has(`${trip.tripDate}|${trip.containerNo}`) }))
    await db.update(scanJobs).set({ status: "succeeded", result: { trips: result }, input: {}, updatedAt: new Date(), completedAt: new Date(), leaseExpiresAt: null }).where(and(eq(scanJobs.id, id), eq(scanJobs.organizationId, organizationId)))
  } catch (error) {
    await db.update(scanJobs).set({ status: "failed", errorCode: "EXTRACTION_FAILED", errorMessage: error instanceof Error ? error.message.slice(0, 500) : "Extraction failed", input: {}, updatedAt: new Date(), completedAt: new Date(), leaseExpiresAt: null }).where(and(eq(scanJobs.id, id), eq(scanJobs.organizationId, organizationId)))
  }
}

export async function POST(req: Request) {
  const tenant = await requireTenant()
  const formData = await req.formData()
  const file = formData.get("image")
  if (!(file instanceof File)) return Response.json({ error: "No image provided" }, { status: 400 })
  if (file.size > 10 * 1024 * 1024) return Response.json({ error: "Image too large (max 10MB)" }, { status: 400 })
  const buffer = Buffer.from(await file.arrayBuffer())
  const idempotencyKey = createHash("sha256").update(buffer).digest("hex")
  const dataUrl = `data:${file.type || "image/jpeg"};base64,${buffer.toString("base64")}`
  const id = randomUUID()
  const [job] = await db.insert(scanJobs).values({ id, organizationId: tenant.organizationId, createdByUserId: tenant.user.id, status: "queued", input: { dataUrl }, idempotencyKey }).onConflictDoNothing().returning()
  const selected = job ?? (await db.select().from(scanJobs).where(and(eq(scanJobs.organizationId, tenant.organizationId), eq(scanJobs.idempotencyKey, idempotencyKey))).limit(1))[0]
  if (job) {
    await writeAudit({ organizationId: tenant.organizationId, actorUserId: tenant.user.id, action: "scan.queued", entityType: "scan_job", entityId: id })
    after(() => processJob(id, tenant.organizationId, dataUrl))
  }
  return Response.json({ jobId: selected.id, status: selected.status }, { status: job ? 202 : 200 })
}

export async function GET(req: Request) {
  const tenant = await requireTenant()
  const id = new URL(req.url).searchParams.get("id")
  if (!id) return Response.json({ error: "Job id required" }, { status: 400 })
  const [job] = await db.select({ id: scanJobs.id, status: scanJobs.status, result: scanJobs.result, errorMessage: scanJobs.errorMessage }).from(scanJobs).where(and(eq(scanJobs.id, id), eq(scanJobs.organizationId, tenant.organizationId))).limit(1)
  if (!job) return Response.json({ error: "Job not found" }, { status: 404 })
  return Response.json(job)
}
