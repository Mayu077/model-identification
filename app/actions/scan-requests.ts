"use server"

import { and, desc, eq, inArray } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { writeAudit } from "@/lib/audit"
import { db } from "@/lib/db"
import { scanJobs } from "@/lib/db/schema"
import { requireDriver, requireOwner } from "@/lib/tenant"

const jobIdSchema = z.string().uuid()
const OWNER_QUEUE_STATUSES = ["uploaded", "queued", "processing", "succeeded", "failed"] as const

export interface DriverUploadRequest {
  id: string
  status: string
  driverId: number | null
  driverName: string | null
  documentType: string | null
  requestedTripDate: string | null
  requestNotes: string | null
  errorMessage: string | null
  hasImage: boolean
  createdAt: Date
  updatedAt: Date
}

export async function getDriverUploadRequests(): Promise<DriverUploadRequest[]> {
  const tenant = await requireOwner()
  const rows = await db
    .select({
      id: scanJobs.id,
      status: scanJobs.status,
      driverId: scanJobs.driverId,
      driverName: scanJobs.submittedByName,
      documentType: scanJobs.documentType,
      requestedTripDate: scanJobs.requestedTripDate,
      requestNotes: scanJobs.requestNotes,
      errorMessage: scanJobs.errorMessage,
      imagePath: scanJobs.imagePath,
      createdAt: scanJobs.createdAt,
      updatedAt: scanJobs.updatedAt,
    })
    .from(scanJobs)
    .where(and(
      eq(scanJobs.organizationId, tenant.organizationId),
      inArray(scanJobs.status, [...OWNER_QUEUE_STATUSES]),
      inArray(scanJobs.documentType, ["receipt", "trip_card"]),
    ))
    .orderBy(desc(scanJobs.createdAt))
    .limit(100)

  return rows.map(({ imagePath, ...row }) => ({ ...row, hasImage: Boolean(imagePath) }))
}

export async function getMyUploadRequests(): Promise<DriverUploadRequest[]> {
  const driver = await requireDriver()
  const rows = await db
    .select({
      id: scanJobs.id,
      status: scanJobs.status,
      driverId: scanJobs.driverId,
      driverName: scanJobs.submittedByName,
      documentType: scanJobs.documentType,
      requestedTripDate: scanJobs.requestedTripDate,
      requestNotes: scanJobs.requestNotes,
      errorMessage: scanJobs.errorMessage,
      imagePath: scanJobs.imagePath,
      createdAt: scanJobs.createdAt,
      updatedAt: scanJobs.updatedAt,
    })
    .from(scanJobs)
    .where(and(eq(scanJobs.organizationId, driver.organizationId), eq(scanJobs.driverId, driver.driverId)))
    .orderBy(desc(scanJobs.createdAt))
    .limit(30)

  return rows.map(({ imagePath, ...row }) => ({ ...row, hasImage: Boolean(imagePath) }))
}

export async function rejectDriverUpload(jobId: string) {
  const tenant = await requireOwner()
  const id = jobIdSchema.parse(jobId)
  const [job] = await db
    .update(scanJobs)
    .set({
      status: "rejected",
      reviewedByUserId: tenant.user.id,
      reviewedAt: new Date(),
      updatedAt: new Date(),
      leaseExpiresAt: null,
    })
    .where(and(
      eq(scanJobs.id, id),
      eq(scanJobs.organizationId, tenant.organizationId),
      inArray(scanJobs.status, ["uploaded", "succeeded", "failed"]),
    ))
    .returning({ id: scanJobs.id, driverId: scanJobs.driverId })
  if (!job) throw new Error("This upload is being scanned or has already been handled")

  await writeAudit({
    organizationId: tenant.organizationId,
    actorUserId: tenant.user.id,
    action: "scan.upload_rejected",
    entityType: "scan_job",
    entityId: id,
    metadata: { driverId: job.driverId },
  })
  revalidatePath("/scan")
  revalidatePath("/driver")
  revalidatePath("/driver/upload")
  revalidatePath("/")
}
