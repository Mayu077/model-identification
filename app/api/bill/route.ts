import { renderToBuffer } from "@react-pdf/renderer"
import { NextRequest, NextResponse } from "next/server"
import { and, between, eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { settings, trips } from "@/lib/db/schema"
import { requireTenantApi } from "@/lib/tenant"
import { BillDocument } from "@/lib/pdf-bill"
import { createElement } from "react"

// PDF rendering can take a moment on first cold start
export const maxDuration = 60

async function resolveOwner(req: NextRequest) {
  try {
    const tenant = await requireTenantApi()
    if (tenant.role !== "owner") {
      return { tenant: null, res: NextResponse.json({ error: "Owner access required" }, { status: 403 }) }
    }
    return { tenant, res: null }
  } catch {
    return { tenant: null, res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  }
}

export async function POST(req: NextRequest) {
  const { tenant, res: authErr } = await resolveOwner(req)
  if (authErr) return authErr

  let from: string, to: string, invoiceNo: string
  try {
    const body = await req.json()
    from = body.from
    to = body.to
    invoiceNo = body.invoiceNo
    if (!from || !to || !invoiceNo) throw new Error("missing fields")
  } catch {
    return NextResponse.json({ error: "Body must include from, to, invoiceNo" }, { status: 400 })
  }

  // Fetch trips in the date range for this org
  const orgTrips = await db
    .select()
    .from(trips)
    .where(
      and(
        eq(trips.organizationId, tenant!.organizationId),
        between(trips.tripDate, from, to),
      ),
    )

  if (orgTrips.length === 0) {
    return NextResponse.json({ error: "No trips found in this date range" }, { status: 404 })
  }

  // Load all settings for this org
  const rows = await db
    .select()
    .from(settings)
    .where(eq(settings.organizationId, tenant!.organizationId))
  const cfg = Object.fromEntries(rows.map((r) => [r.key, r.value]))

  // Render PDF
  const buffer = await renderToBuffer(
    createElement(BillDocument, {
      trips: orgTrips,
      from,
      to,
      invoiceNo,
      s: cfg as Parameters<typeof BillDocument>[0]["s"],
    }),
  )

  const filename = `Bill_${invoiceNo.replace(/[/\\:]/g, "-")}.pdf`
  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(buffer.byteLength),
    },
  })
}
