import { NextRequest, NextResponse } from "next/server"
import { requireTenantApi } from "@/lib/tenant"
import { putLetterhead, deleteLetterhead } from "@/lib/blob"
import { db } from "@/lib/db"
import { settings } from "@/lib/db/schema"
import { and, eq } from "drizzle-orm"
import { writeAudit } from "@/lib/audit"

const ALLOWED_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
}

const MAX_BYTES = 4 * 1024 * 1024 // 4 MB

async function resolveOwner(req: NextRequest) {
  try {
    const tenant = await requireTenantApi()
    if (tenant.role !== "owner") {
      return { tenant: null, res: NextResponse.json({ error: "Owner only" }, { status: 403 }) }
    }
    return { tenant, res: null }
  } catch {
    return { tenant: null, res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  }
}

/** POST /api/letterhead — upload a new letterhead image */
export async function POST(req: NextRequest) {
  const { tenant, res: authErr } = await resolveOwner(req)
  if (authErr) return authErr

  const formData = await req.formData().catch(() => null)
  const file = formData?.get("file")
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "Multipart field 'file' is required" }, { status: 400 })
  }

  const ext = ALLOWED_TYPES[file.type]
  if (!ext) {
    return NextResponse.json(
      { error: "Only PNG, JPEG, or WebP images are supported" },
      { status: 415 },
    )
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File must be 4 MB or smaller" }, { status: 413 })
  }

  const arrayBuffer = await file.arrayBuffer()
  const body = Buffer.from(arrayBuffer)

  // Delete old letterhead if one exists
  const [existing] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(and(eq(settings.organizationId, tenant!.organizationId), eq(settings.key, "letterhead_url")))
    .limit(1)
  if (existing?.value) {
    await deleteLetterhead(existing.value)
  }

  // Upload new letterhead
  const url = await putLetterhead(tenant!.organizationId, body, file.type, ext)

  // Persist URL in settings
  await db
    .insert(settings)
    .values({ organizationId: tenant!.organizationId, key: "letterhead_url", value: url })
    .onConflictDoUpdate({
      target: [settings.organizationId, settings.key],
      set: { value: url },
    })

  await writeAudit({
    organizationId: tenant!.organizationId,
    actorUserId: tenant!.user.id,
    action: "setting.updated",
    entityType: "setting",
    entityId: "letterhead_url",
  })

  return NextResponse.json({ url })
}

/** DELETE /api/letterhead — remove the letterhead */
export async function DELETE(req: NextRequest) {
  const { tenant, res: authErr } = await resolveOwner(req)
  if (authErr) return authErr

  const [existing] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(and(eq(settings.organizationId, tenant!.organizationId), eq(settings.key, "letterhead_url")))
    .limit(1)

  if (existing?.value) {
    await deleteLetterhead(existing.value)
    await db
      .delete(settings)
      .where(and(eq(settings.organizationId, tenant!.organizationId), eq(settings.key, "letterhead_url")))
  }

  await writeAudit({
    organizationId: tenant!.organizationId,
    actorUserId: tenant!.user.id,
    action: "setting.updated",
    entityType: "setting",
    entityId: "letterhead_url",
  })

  return NextResponse.json({ ok: true })
}
