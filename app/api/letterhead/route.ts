import { NextRequest, NextResponse } from "next/server"
import { requireTenantApi } from "@/lib/tenant"
import { db } from "@/lib/db"
import { settings } from "@/lib/db/schema"
import { and, eq } from "drizzle-orm"
import { writeAudit } from "@/lib/audit"

// ─── Letterhead storage ──────────────────────────────────────────────────────
// The letterhead is stored as a base64 data URI in the `letterhead_url` setting.
// We avoid Vercel Blob here because the project's Blob store is configured as
// private (so `access: "public"` is rejected), and the PDF renderer can't fetch
// a token-protected URL at render time. A data URI works for both the in-app
// preview <img> and @react-pdf/renderer's <Image>, with no network fetch needed.
//
// The browser already converts PDF first-pages to PNG before upload (see
// components/settings/letterhead-card.tsx), so the server only ever sees an
// image file here.

const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/jpg"])
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

/** POST /api/letterhead — store a new letterhead image as a data URI */
export async function POST(req: NextRequest) {
  const { tenant, res: authErr } = await resolveOwner(req)
  if (authErr) return authErr

  const formData = await req.formData().catch(() => null)
  const file = formData?.get("file")
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "Multipart field 'file' is required" }, { status: 400 })
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: "Only PNG or JPEG images are supported (PDFs are converted to PNG in the browser)" },
      { status: 415 },
    )
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File must be 4 MB or smaller" }, { status: 413 })
  }

  const arrayBuffer = await file.arrayBuffer()
  const body = Buffer.from(arrayBuffer)
  const dataUri = `data:${file.type};base64,${body.toString("base64")}`

  await db
    .insert(settings)
    .values({
      organizationId: tenant!.organizationId,
      key: "letterhead_url",
      value: dataUri,
    })
    .onConflictDoUpdate({
      target: [settings.organizationId, settings.key],
      set: { value: dataUri },
    })

  await writeAudit({
    organizationId: tenant!.organizationId,
    actorUserId: tenant!.user.id,
    action: "setting.updated",
    entityType: "setting",
    entityId: "letterhead_url",
  })

  return NextResponse.json({ ok: true })
}

/** DELETE /api/letterhead — remove the letterhead */
export async function DELETE(req: NextRequest) {
  const { tenant, res: authErr } = await resolveOwner(req)
  if (authErr) return authErr

  await db
    .delete(settings)
    .where(and(eq(settings.organizationId, tenant!.organizationId), eq(settings.key, "letterhead_url")))

  await writeAudit({
    organizationId: tenant!.organizationId,
    actorUserId: tenant!.user.id,
    action: "setting.updated",
    entityType: "setting",
    entityId: "letterhead_url",
  })

  return NextResponse.json({ ok: true })
}
