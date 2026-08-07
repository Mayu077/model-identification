import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer"
import {
  amountInWords,
  billSize,
  formatDateDDMMYYYY,
  serviceLabel,
  tripKindOf,
  categoryLabel,
} from "@/lib/domain"
import type { Trip } from "@/lib/db/schema"
import type { BillSettings } from "@/lib/export"

// ─── layout constants ──────────────────────────────────────────────────────
const CATEGORY_ORDER = ["JWC EXPORT", "JWC IMPORT", "JWR EXPORT", "JWR IMPORT"]

const COL = {
  sr: 28,
  particulars: 118,
  service: 62,
  size: 36,
  qty: 46,
  rate: 55,
  amount: 62,
} as const

const NAVY = "#1a237e"
const LIGHT_NAVY = "#e8eaf6"
const BORDER = "#b0bec5"
const MUTED = "#546e7a"
const WHITE = "#ffffff"
const ROW_ALT = "#f5f7ff"

const s = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 8,
    color: "#212121",
    paddingHorizontal: 38,
    paddingVertical: 32,
  },
  // ── header ──
  headerWrap: { alignItems: "center", marginBottom: 8 },
  bizName: { fontFamily: "Helvetica-Bold", fontSize: 15, marginBottom: 2 },
  tagline: { fontSize: 8.5, marginBottom: 1 },
  headerMeta: { fontSize: 7.5, color: MUTED },
  divider: { borderBottomWidth: 1.5, borderBottomColor: NAVY, marginVertical: 7 },
  thinDivider: { borderBottomWidth: 0.5, borderBottomColor: BORDER, marginVertical: 5 },
  // ── invoice meta block ──
  invoiceTitle: { fontFamily: "Helvetica-Bold", fontSize: 10, marginBottom: 6 },
  metaRow: { flexDirection: "row", marginBottom: 2.5 },
  metaHalf: { width: "50%" },
  metaKey: { fontFamily: "Helvetica-Bold", fontSize: 7.5, width: 90 },
  metaVal: { fontSize: 7.5 },
  // ── table ──
  table: { marginTop: 10 },
  th: {
    flexDirection: "row",
    backgroundColor: NAVY,
    paddingVertical: 4,
    paddingHorizontal: 3,
  },
  thCell: { fontFamily: "Helvetica-Bold", color: WHITE, fontSize: 7 },
  tr: {
    flexDirection: "row",
    borderBottomWidth: 0.4,
    borderBottomColor: BORDER,
    paddingVertical: 3,
    paddingHorizontal: 3,
  },
  trAlt: {
    flexDirection: "row",
    backgroundColor: ROW_ALT,
    borderBottomWidth: 0.4,
    borderBottomColor: BORDER,
    paddingVertical: 3,
    paddingHorizontal: 3,
  },
  td: { fontSize: 7.5 },
  tdR: { fontSize: 7.5, textAlign: "right" },
  // column widths
  cSr: { width: COL.sr },
  cParticulars: { width: COL.particulars },
  cService: { width: COL.service },
  cSize: { width: COL.size, textAlign: "center" },
  cQty: { width: COL.qty, textAlign: "center" },
  cRate: { width: COL.rate, textAlign: "right" },
  cAmount: { width: COL.amount, textAlign: "right" },
  // ── totals ──
  totalsWrap: {
    marginTop: 2,
    alignSelf: "flex-end",
    width: COL.qty + COL.rate + COL.amount + 6,
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 2.5,
    paddingHorizontal: 3,
    borderBottomWidth: 0.4,
    borderBottomColor: BORDER,
  },
  totalLabel: { fontSize: 7.5 },
  totalVal: { fontSize: 7.5, textAlign: "right" },
  grandTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3.5,
    paddingHorizontal: 3,
    backgroundColor: LIGHT_NAVY,
    marginTop: 1,
  },
  grandLabel: { fontFamily: "Helvetica-Bold", fontSize: 8 },
  grandVal: { fontFamily: "Helvetica-Bold", fontSize: 8, textAlign: "right" },
  // ── amount in words ──
  amtWords: { marginTop: 8, fontSize: 7.5, fontFamily: "Helvetica-Bold" },
  amtWordsVal: { fontFamily: "Helvetica", color: "#333" },
  // ── bank details ──
  bankWrap: { marginTop: 14, borderTopWidth: 1, borderTopColor: BORDER, paddingTop: 8 },
  bankTitle: { fontFamily: "Helvetica-Bold", fontSize: 8, marginBottom: 5 },
  bankRow: { flexDirection: "row", marginBottom: 2.5 },
  bankKey: { fontFamily: "Helvetica-Bold", fontSize: 7.5, width: 90 },
  bankVal: { fontSize: 7.5 },
  // ── footer ──
  footer: {
    position: "absolute",
    bottom: 32,
    right: 38,
    alignItems: "flex-end",
  },
  footerFor: { fontSize: 7.5, fontFamily: "Helvetica-Bold" },
  footerSig: { fontSize: 7, color: MUTED, marginTop: 18 },
})

// ─── helpers ────────────────────────────────────────────────────────────────
function fmt(n: number) {
  return n.toLocaleString("en-IN")
}

function billingPeriodLabel(from: string, to: string) {
  return `${formatDateDDMMYYYY(from)} to ${formatDateDDMMYYYY(to)}`
}

function todayDDMMYYYY() {
  const d = new Date()
  return `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`
}

// ─── build line items (same logic as downloadBillExcel) ─────────────────────
interface BillLine {
  service: string
  size: string
  qty: number
  rate: number
  amount: number
  sortKey: string
}

function buildLines(trips: Trip[]): BillLine[] {
  const map = new Map<string, BillLine>()
  for (const t of trips) {
    const kind = tripKindOf(t.size, t.tripType)
    const key = `${t.company}|${t.direction}|${kind}`
    const existing = map.get(key)
    if (existing) {
      existing.qty += 1
      existing.amount += t.rate
    } else {
      map.set(key, {
        service: serviceLabel(t.company, t.direction),
        size: billSize(t.size, t.tripType),
        qty: 1,
        rate: t.rate,
        amount: t.rate,
        sortKey: `${CATEGORY_ORDER.indexOf(categoryLabel(t.company, t.direction))}-${kind}`,
      })
    }
  }
  return [...map.values()].sort((a, b) => a.sortKey.localeCompare(b.sortKey))
}

// ─── document ───────────────────────────────────────────────────────────────
export interface PdfBillProps {
  trips: Trip[]
  from: string
  to: string
  invoiceNo: string
  s: BillSettings
}

export function BillDocument({ trips, from, to, invoiceNo, s: cfg }: PdfBillProps) {
  const lines = buildLines(trips)
  const totalQty = lines.reduce((acc, l) => acc + l.qty, 0)
  const subtotal = lines.reduce((acc, l) => acc + l.amount, 0)
  const gstPct = Number.parseFloat(cfg.gst_percent || "9")
  const cgst = Math.round((subtotal * gstPct) / 100)
  const sgst = Math.round((subtotal * gstPct) / 100)
  const grandTotal = subtotal + cgst + sgst

  return (
    <Document>
      <Page size="A4" style={s.page}>

        {/* ── Header ── */}
        <View style={s.headerWrap}>
          <Text style={s.bizName}>{cfg.business_name || "RAJESHRI ENTERPRISES"}</Text>
          <Text style={s.tagline}>{cfg.business_tagline || ""}</Text>
          <Text style={s.headerMeta}>Address: {cfg.business_address}</Text>
          <Text style={s.headerMeta}>
            Mob: {cfg.business_mobile}{"   |   "}Email: {cfg.business_email}
          </Text>
        </View>

        <View style={s.divider} />

        {/* ── Invoice meta ── */}
        <Text style={s.invoiceTitle}>INVOICE</Text>
        <View style={s.metaRow}>
          <View style={s.metaHalf}>
            <View style={{ flexDirection: "row" }}>
              <Text style={s.metaKey}>Invoice No:</Text>
              <Text style={s.metaVal}>{invoiceNo}</Text>
            </View>
          </View>
          <View style={s.metaHalf}>
            <View style={{ flexDirection: "row" }}>
              <Text style={s.metaKey}>Client Name:</Text>
              <Text style={s.metaVal}>{cfg.bill_to}</Text>
            </View>
          </View>
        </View>
        <View style={s.metaRow}>
          <View style={s.metaHalf}>
            <View style={{ flexDirection: "row" }}>
              <Text style={s.metaKey}>Invoice Date:</Text>
              <Text style={s.metaVal}>{todayDDMMYYYY()}</Text>
            </View>
          </View>
          <View style={s.metaHalf}>
            <View style={{ flexDirection: "row" }}>
              <Text style={s.metaKey}>Billing Address:</Text>
              <Text style={s.metaVal}>{cfg.billing_address || ""}</Text>
            </View>
          </View>
        </View>
        <View style={s.metaRow}>
          <View style={s.metaHalf}>
            <View style={{ flexDirection: "row" }}>
              <Text style={s.metaKey}>Vehicle Number:</Text>
              <Text style={s.metaVal}>{cfg.vehicle_number || ""}</Text>
            </View>
          </View>
          <View style={s.metaHalf}>
            <View style={{ flexDirection: "row" }}>
              <Text style={s.metaKey}>Billing Period:</Text>
              <Text style={s.metaVal}>{billingPeriodLabel(from, to)}</Text>
            </View>
          </View>
        </View>

        <View style={s.thinDivider} />

        {/* ── Line items table ── */}
        <View style={s.table}>
          {/* header row */}
          <View style={s.th}>
            <Text style={[s.thCell, s.cSr]}>SR.</Text>
            <Text style={[s.thCell, s.cParticulars]}>PARTICULARS</Text>
            <Text style={[s.thCell, s.cService]}>SERVICE</Text>
            <Text style={[s.thCell, s.cSize, { textAlign: "center" }]}>SIZE</Text>
            <Text style={[s.thCell, s.cQty, { textAlign: "center" }]}>QTY</Text>
            <Text style={[s.thCell, s.cRate, { textAlign: "right" }]}>RATE</Text>
            <Text style={[s.thCell, s.cAmount, { textAlign: "right" }]}>AMOUNT</Text>
          </View>
          {/* data rows */}
          {lines.map((line, i) => (
            <View key={line.sortKey} style={i % 2 === 0 ? s.tr : s.trAlt}>
              <Text style={[s.td, s.cSr]}>{i + 1}</Text>
              <Text style={[s.td, s.cParticulars]}>Transportation charges</Text>
              <Text style={[s.td, s.cService]}>{line.service}</Text>
              <Text style={[s.td, s.cSize]}>{line.size}</Text>
              <Text style={[s.td, s.cQty]}>{line.qty}</Text>
              <Text style={[s.tdR, s.cRate]}>{fmt(line.rate)}</Text>
              <Text style={[s.tdR, s.cAmount]}>{fmt(line.amount)}</Text>
            </View>
          ))}
        </View>

        {/* ── Totals ── */}
        <View style={s.totalsWrap}>
          <View style={s.totalRow}>
            <Text style={[s.totalLabel, { fontFamily: "Helvetica-Bold" }]}>
              TOTAL ({totalQty} trips)
            </Text>
            <Text style={s.totalVal}>{fmt(subtotal)}</Text>
          </View>
          <View style={s.totalRow}>
            <Text style={s.totalLabel}>CGST {gstPct}%</Text>
            <Text style={s.totalVal}>{fmt(cgst)}</Text>
          </View>
          <View style={s.totalRow}>
            <Text style={s.totalLabel}>SGST {gstPct}%</Text>
            <Text style={s.totalVal}>{fmt(sgst)}</Text>
          </View>
          <View style={s.grandTotalRow}>
            <Text style={s.grandLabel}>GRAND TOTAL (INR)</Text>
            <Text style={s.grandVal}>{fmt(grandTotal)}</Text>
          </View>
        </View>

        {/* ── Amount in words ── */}
        <Text style={s.amtWords}>
          {"TOTAL IN WORDS :- "}
          <Text style={s.amtWordsVal}>{amountInWords(grandTotal)}</Text>
        </Text>

        {/* ── GSTIN / PAN ── */}
        <View style={{ marginTop: 6, flexDirection: "row", gap: 24 }}>
          <Text style={{ fontSize: 7.5 }}>
            <Text style={{ fontFamily: "Helvetica-Bold" }}>GSTIN: </Text>{cfg.gstin}
          </Text>
          <Text style={{ fontSize: 7.5 }}>
            <Text style={{ fontFamily: "Helvetica-Bold" }}>PAN: </Text>{cfg.pan}
          </Text>
        </View>

        {/* ── Bank details ── */}
        {cfg.bank_name && (
          <View style={s.bankWrap}>
            <Text style={s.bankTitle}>BANK ACCOUNT DETAILS</Text>
            {cfg.bank_account_name && (
              <View style={s.bankRow}>
                <Text style={s.bankKey}>Account Name:</Text>
                <Text style={s.bankVal}>{cfg.bank_account_name}</Text>
              </View>
            )}
            <View style={s.bankRow}>
              <Text style={s.bankKey}>Bank Name:</Text>
              <Text style={s.bankVal}>{cfg.bank_name}</Text>
            </View>
            {cfg.bank_account_no && (
              <View style={s.bankRow}>
                <Text style={s.bankKey}>Account No:</Text>
                <Text style={s.bankVal}>{cfg.bank_account_no}</Text>
              </View>
            )}
            {cfg.bank_ifsc && (
              <View style={s.bankRow}>
                <Text style={s.bankKey}>IFSC Code:</Text>
                <Text style={s.bankVal}>{cfg.bank_ifsc}</Text>
              </View>
            )}
            {cfg.bank_branch && (
              <View style={s.bankRow}>
                <Text style={s.bankKey}>Branch:</Text>
                <Text style={s.bankVal}>{cfg.bank_branch}</Text>
              </View>
            )}
          </View>
        )}

        {/* ── Authorized signatory ── */}
        <View style={s.footer}>
          <Text style={s.footerFor}>
            For {cfg.authorized_signatory || cfg.business_name || ""}
          </Text>
          <Text style={s.footerSig}>Authorized Signatory</Text>
        </View>

      </Page>
    </Document>
  )
}
