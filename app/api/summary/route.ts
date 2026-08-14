import ExcelJS from "exceljs"
import { NextRequest, NextResponse } from "next/server"
import { and, between, eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { trips } from "@/lib/db/schema"
import { requireTenantApi } from "@/lib/tenant"
import { billSize, categoryLabel, formatDateDDMMYYYY } from "@/lib/domain"
import type { Trip } from "@/lib/db/schema"

export const maxDuration = 30

// ─── style constants ─────────────────────────────────────────────────────────
const CATEGORY_ORDER = ["JWC EXPORT", "JWC IMPORT", "JWR EXPORT", "JWR IMPORT"]

/** Thin black border on all four sides */
const THIN: Partial<ExcelJS.Border> = { style: "thin", color: { argb: "FF000000" } }
const BORDERS: Partial<ExcelJS.Borders> = { top: THIN, left: THIN, bottom: THIN, right: THIN }

/** Center + middle alignment */
const CENTER: Partial<ExcelJS.Alignment> = { horizontal: "center", vertical: "middle", wrapText: true }

const FONT_HEADING: Partial<ExcelJS.Font> = { name: "Montserrat", bold: true, size: 12 }
const FONT_COL_HDR: Partial<ExcelJS.Font> = { name: "Montserrat", bold: true, size: 10 }
const FONT_DATA: Partial<ExcelJS.Font> = { name: "Calibri", size: 11 }
const FONT_TOTAL: Partial<ExcelJS.Font> = { name: "Calibri", size: 11, bold: true }
const FONT_GRAND: Partial<ExcelJS.Font> = { name: "Montserrat", bold: true, size: 12 }

const NUM_COLS = 8 // A–H

// ─── helpers ─────────────────────────────────────────────────────────────────
function applyBordersToRow(row: ExcelJS.Row) {
  for (let c = 1; c <= NUM_COLS; c++) {
    row.getCell(c).border = BORDERS
  }
}

function groupByCategory(tripList: Trip[]): Map<string, Trip[]> {
  const map = new Map<string, Trip[]>()
  for (const cat of CATEGORY_ORDER) map.set(cat, [])
  for (const t of tripList) {
    const cat = categoryLabel(t.company, t.direction)
    if (!map.has(cat)) map.set(cat, [])
    map.get(cat)!.push(t)
  }
  for (const [, list] of map) {
    list.sort((a, b) => a.tripDate.localeCompare(b.tripDate) || a.id - b.id)
  }
  return map
}

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

// ─── route ───────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const { tenant, res: authErr } = await resolveOwner(req)
  if (authErr) return authErr

  let from: string, to: string
  try {
    const body = await req.json()
    from = body.from
    to = body.to
    if (!from || !to) throw new Error("missing")
  } catch {
    return NextResponse.json({ error: "Body must include from and to" }, { status: 400 })
  }

  const orgTrips = await db
    .select()
    .from(trips)
    .where(and(eq(trips.organizationId, tenant!.organizationId), between(trips.tripDate, from, to)))

  // Build workbook
  const wb = new ExcelJS.Workbook()
  wb.creator = "FleetOS"
  const ws = wb.addWorksheet("SUMMARY")

  // Column widths (in character units)
  ws.columns = [
    { width: 6 },   // A: SR.
    { width: 13 },  // B: DATE
    { width: 18 },  // C: CONTAINER NO.
    { width: 14 },  // D: SIZE / TYPE
    { width: 9 },   // E: FROM
    { width: 9 },   // F: TO
    { width: 10 },  // G: RATE
    { width: 12 },  // H: AMOUNT
  ]

  // ── Date range header ────────────────────────────────────────────────────
  const periodLabel = `${formatDateDDMMYYYY(from)}  to  ${formatDateDDMMYYYY(to)}`
  const headerRow = ws.addRow([periodLabel, "", "", "", "", "", "", ""])
  headerRow.height = 35
  headerRow.getCell(1).font = FONT_HEADING
  headerRow.getCell(1).alignment = CENTER
  ws.mergeCells(`A${headerRow.number}:H${headerRow.number}`)
  applyBordersToRow(headerRow)

  ws.addRow([]) // spacer

  const grouped = groupByCategory(orgTrips)
  let grandTotal = 0

  for (const [cat, list] of grouped) {
    if (list.length === 0) continue

    // ── Category heading ──────────────────────────────────────────────────
    const catRow = ws.addRow([cat, "", "", "", "", "", "", ""])
    catRow.height = 35
    catRow.getCell(1).font = FONT_HEADING
    catRow.getCell(1).alignment = CENTER
    ws.mergeCells(`A${catRow.number}:H${catRow.number}`)
    applyBordersToRow(catRow)

    // ── Column header ─────────────────────────────────────────────────────
    const colHdrRow = ws.addRow([
      "SR.", "DATE", "CONTAINER NO.", "SIZE / TYPE", "FROM", "TO", "RATE", "AMOUNT",
    ])
    colHdrRow.height = 35
    for (let c = 1; c <= NUM_COLS; c++) {
      const cell = colHdrRow.getCell(c)
      cell.font = FONT_COL_HDR
      cell.alignment = CENTER
      cell.border = BORDERS
    }

    // ── Data rows ─────────────────────────────────────────────────────────
    let subtotal = 0
    list.forEach((t, i) => {
      const containerCell =
        t.tripType === "double" && t.containerNo2
          ? `${t.containerNo} / ${t.containerNo2}`
          : t.containerNo

      const dataRow = ws.addRow([
        i + 1,
        formatDateDDMMYYYY(t.tripDate),
        containerCell,
        billSize(t.size, t.tripType),
        t.fromLocation,
        t.toLocation,
        t.rate,
        t.rate,
      ])
      dataRow.height = 24
      for (let c = 1; c <= NUM_COLS; c++) {
        const cell = dataRow.getCell(c)
        cell.font = FONT_DATA
        cell.alignment = CENTER
        cell.border = BORDERS
      }
      subtotal += t.rate
    })

    // ── Subtotal row ──────────────────────────────────────────────────────
    const totalRow = ws.addRow(["", "", "", "", "", "TOTAL", "", subtotal])
    totalRow.height = 24
    for (let c = 1; c <= NUM_COLS; c++) {
      const cell = totalRow.getCell(c)
      cell.font = FONT_TOTAL
      cell.alignment = CENTER
      cell.border = BORDERS
    }
    ws.addRow([]) // spacer between categories

    grandTotal += subtotal
  }

  // ── Grand total ───────────────────────────────────────────────────────────
  const gtRow = ws.addRow(["", "", "", "", "", "", "GRAND TOTAL", grandTotal])
  gtRow.height = 35
  gtRow.getCell(7).font = FONT_GRAND
  gtRow.getCell(7).alignment = CENTER
  gtRow.getCell(8).font = FONT_GRAND
  gtRow.getCell(8).alignment = CENTER
  applyBordersToRow(gtRow)
  ws.mergeCells(`A${gtRow.number}:F${gtRow.number}`)
  gtRow.getCell(1).border = BORDERS // re-apply after merge collapse

  // ── Stream back ───────────────────────────────────────────────────────────
  const buffer = await wb.xlsx.writeBuffer()
  const dateTag = `${formatDateDDMMYYYY(from)}_to_${formatDateDDMMYYYY(to)}`
  const filename = `Summary_${dateTag}.xlsx`

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(buffer.byteLength),
    },
  })
}
