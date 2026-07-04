import { utils, writeFile, type WorkSheet } from "xlsx"
import {
  amountInWords,
  billSize,
  categoryLabel,
  formatDateDDMMYYYY,
  serviceLabel,
  tripKindOf,
} from "@/lib/domain"
import type { Trip } from "@/lib/db/schema"

// Category ordering used in both files: JWC EXPORT, JWC IMPORT, JWR EXPORT, JWR IMPORT
const CATEGORY_ORDER = [
  "JWC EXPORT",
  "JWC IMPORT",
  "JWR EXPORT",
  "JWR IMPORT",
]

function groupByCategory(trips: Trip[]): Map<string, Trip[]> {
  const map = new Map<string, Trip[]>()
  for (const cat of CATEGORY_ORDER) map.set(cat, [])
  for (const t of trips) {
    const cat = categoryLabel(t.company, t.direction)
    if (!map.has(cat)) map.set(cat, [])
    map.get(cat)!.push(t)
  }
  for (const [, list] of map) {
    list.sort((a, b) => a.tripDate.localeCompare(b.tripDate) || a.id - b.id)
  }
  return map
}

function autoWidth(ws: WorkSheet, rows: unknown[][]) {
  const colWidths: number[] = []
  for (const row of rows) {
    row.forEach((cell, i) => {
      const len = cell == null ? 0 : String(cell).length
      colWidths[i] = Math.max(colWidths[i] ?? 8, len + 2)
    })
  }
  ws["!cols"] = colWidths.map((wch) => ({ wch: Math.min(wch, 30) }))
}

/**
 * Summary.xlsx — matches the user's real summary sheet:
 * a billing-period header, then a section per category with
 * SR. | DATE | CONTAINER NO. | SIZE / TYPE | FROM | TO | RATE | AMOUNT
 * and a subtotal row per section plus a grand total.
 */
export function downloadSummaryExcel(trips: Trip[], from: string, to: string) {
  const rows: unknown[][] = []
  rows.push([`${formatDateDDMMYYYY(from)} to ${formatDateDDMMYYYY(to)}`])
  rows.push([])

  const grouped = groupByCategory(trips)
  let grandTotal = 0

  for (const [cat, list] of grouped) {
    if (list.length === 0) continue
    rows.push([cat])
    rows.push(["SR.", "DATE", "CONTAINER NO.", "SIZE / TYPE", "FROM", "TO", "RATE", "AMOUNT"])
    let subtotal = 0
    list.forEach((t, i) => {
      const containerCell =
        t.tripType === "double" && t.containerNo2
          ? `${t.containerNo} / ${t.containerNo2}`
          : t.containerNo
      rows.push([
        i + 1,
        formatDateDDMMYYYY(t.tripDate),
        containerCell,
        billSize(t.size, t.tripType),
        t.fromLocation,
        t.toLocation,
        t.rate,
        t.rate,
      ])
      subtotal += t.rate
    })
    rows.push([null, null, null, null, null, "TOTAL", null, subtotal])
    rows.push([])
    grandTotal += subtotal
  }

  rows.push([null, null, null, null, null, "GRAND TOTAL", null, grandTotal])

  const ws = utils.aoa_to_sheet(rows)
  autoWidth(ws, rows)
  const wb = utils.book_new()
  utils.book_append_sheet(wb, ws, "SUMMARY")
  writeFile(wb, `Summary_${formatDateDDMMYYYY(from)}_to_${formatDateDDMMYYYY(to)}.xlsx`)
}

export interface BillSettings {
  business_name: string
  business_tagline: string
  business_address: string
  business_mobile: string
  business_email: string
  gstin: string
  pan: string
  gst_percent: string
  bill_to: string
}

/**
 * Bill.xlsx — matches the RAJESHRI ENTERPRISES invoice:
 * header block, invoice meta, then
 * SR. NO. | PARTICULARS | SERVICE | SIZE | QUANTITY | RATE | AMOUNT
 * one row per (category, size-kind) present in the range, with
 * TOTAL, CGST, SGST, GRAND TOTAL and amount in words.
 */
export function downloadBillExcel(
  trips: Trip[],
  from: string,
  to: string,
  invoiceNo: string,
  s: BillSettings,
) {
  // Build billing lines: group by company+direction+kind
  interface Line {
    service: string
    size: string
    qty: number
    rate: number
    amount: number
    sortKey: string
  }
  const lineMap = new Map<string, Line>()
  for (const t of trips) {
    const kind = tripKindOf(t.size, t.tripType)
    const key = `${t.company}|${t.direction}|${kind}`
    const existing = lineMap.get(key)
    if (existing) {
      existing.qty += 1
      existing.amount += t.rate
    } else {
      lineMap.set(key, {
        service: serviceLabel(t.company, t.direction),
        size: billSize(t.size, t.tripType),
        qty: 1,
        rate: t.rate,
        amount: t.rate,
        sortKey: `${CATEGORY_ORDER.indexOf(categoryLabel(t.company, t.direction))}-${kind}`,
      })
    }
  }
  const lines = [...lineMap.values()].sort((a, b) =>
    a.sortKey.localeCompare(b.sortKey),
  )

  const totalQty = lines.reduce((s2, l) => s2 + l.qty, 0)
  const total = lines.reduce((s2, l) => s2 + l.amount, 0)
  const gstPct = Number.parseFloat(s.gst_percent || "9")
  const cgst = Math.round((total * gstPct) / 100)
  const sgst = Math.round((total * gstPct) / 100)
  const grandTotal = total + cgst + sgst

  const today = new Date()
  const todayStr = `${String(today.getDate()).padStart(2, "0")}-${String(today.getMonth() + 1).padStart(2, "0")}-${today.getFullYear()}`

  const rows: unknown[][] = []
  rows.push([s.business_name])
  rows.push([s.business_tagline])
  rows.push([`Address: ${s.business_address}`])
  rows.push([`Mob: ${s.business_mobile}   |   Email: ${s.business_email}`])
  rows.push([])
  rows.push([`Date:- ${todayStr}`, null, null, null, null, `Invoice No:- ${invoiceNo}`])
  rows.push([`TO, ${s.bill_to}`])
  rows.push([`Billing period: ${formatDateDDMMYYYY(from)} to ${formatDateDDMMYYYY(to)}`])
  rows.push([])
  rows.push(["SR. NO.", "PARTICULARS", "SERVICE", "SIZE", "QUANTITY", "RATE", "AMOUNT"])
  lines.forEach((l, i) => {
    rows.push([i + 1, "Transportation charges", l.service, l.size, l.qty, l.rate, l.amount])
  })
  rows.push([null, null, null, "TOTAL", totalQty, null, total])
  rows.push([null, null, null, `CGST ${gstPct}%`, null, null, cgst])
  rows.push([null, null, null, `SGST ${gstPct}%`, null, null, sgst])
  rows.push([null, null, null, "GRAND TOTAL", null, null, grandTotal])
  rows.push([])
  rows.push([`TOTAL IN WORDS :- ${amountInWords(grandTotal)}`])
  rows.push([])
  rows.push([`GSTIN : ${s.gstin}`])
  rows.push([`PAN No. :- ${s.pan}`])

  const ws = utils.aoa_to_sheet(rows)
  autoWidth(ws, rows)
  const wb = utils.book_new()
  utils.book_append_sheet(wb, ws, "BILL")
  writeFile(wb, `Bill_${invoiceNo.replace(/[/\\]/g, "-")}.xlsx`)
}
