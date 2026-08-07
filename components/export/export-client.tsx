"use client"

import { useState } from "react"
import { getTrips } from "@/app/actions/trips"
import { nextInvoiceNumber } from "@/app/actions/settings"
import { downloadBillExcel, downloadSummaryExcel, type BillSettings } from "@/lib/export"
import { formatINR, serviceLabel } from "@/lib/domain"
import type { Trip } from "@/lib/db/schema"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { toast } from "sonner"
import { FileSpreadsheet, Loader2, ReceiptText, FileText } from "lucide-react"

function isoDaysAgo(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

export function ExportClient({ settings }: { settings: Record<string, string> }) {
  const [from, setFrom] = useState(isoDaysAgo(15))
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10))
  const [loading, setLoading] = useState(false)
  const [previewTrips, setPreviewTrips] = useState<Trip[] | null>(null)

  async function loadPreview() {
    if (!from || !to) {
      toast.warning("Select both dates")
      return
    }
    setLoading(true)
    try {
      const trips = await getTrips(from, to)
      setPreviewTrips(trips)
      if (trips.length === 0) toast.warning("No trips in this date range")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load trips")
    } finally {
      setLoading(false)
    }
  }

  async function handleExport() {
    if (!previewTrips || previewTrips.length === 0) return
    setLoading(true)
    try {
      downloadSummaryExcel(previewTrips, from, to)
      const invoiceNo = await nextInvoiceNumber()
      downloadBillExcel(previewTrips, from, to, invoiceNo, settings as unknown as BillSettings)
      toast.success(`Summary + Bill ${invoiceNo} downloaded`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed")
    } finally {
      setLoading(false)
    }
  }

  async function handlePdfBill() {
    if (!previewTrips || previewTrips.length === 0) return
    setLoading(true)
    try {
      const invoiceNo = await nextInvoiceNumber()
      const res = await fetch("/api/bill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to, invoiceNo }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "PDF generation failed" }))
        throw new Error(err.error ?? "PDF generation failed")
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `Bill_${invoiceNo.replace(/[/\\:]/g, "-")}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast.success(`Bill ${invoiceNo} downloaded as PDF`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "PDF export failed")
    } finally {
      setLoading(false)
    }
  }

  // Category summary for preview
  const categorySummary = previewTrips
    ? [...previewTrips.reduce((map, t) => {
        const key = serviceLabel(t.company, t.direction)
        const cur = map.get(key) ?? { qty: 0, amount: 0 }
        map.set(key, { qty: cur.qty + 1, amount: cur.amount + t.rate })
        return map
      }, new Map<string, { qty: number; amount: number }>())]
    : []

  const total = previewTrips?.reduce((s, t) => s + t.rate, 0) ?? 0

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Billing period</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="from">From</Label>
              <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="to">To</Label>
              <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setFrom(isoDaysAgo(5))
                setTo(new Date().toISOString().slice(0, 10))
              }}
            >
              Last 5 days
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setFrom(isoDaysAgo(15))
                setTo(new Date().toISOString().slice(0, 10))
              }}
            >
              Last 15 days
            </Button>
            <Button onClick={loadPreview} disabled={loading} className="ml-auto">
              {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
              Load Trips
            </Button>
          </div>
        </CardContent>
      </Card>

      {previewTrips && previewTrips.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {previewTrips.length} trips · {formatINR(total)}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              {categorySummary.map(([cat, v]) => (
                <div key={cat} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{cat}</span>
                  <span>
                    {v.qty} trips · <span className="font-medium">{formatINR(v.amount)}</span>
                  </span>
                </div>
              ))}
            </div>
            <Separator />
            <div className="flex flex-col gap-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Sub total</span>
                <span className="font-medium">{formatINR(total)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">
                  CGST {settings.gst_percent ?? "9"}% + SGST {settings.gst_percent ?? "9"}%
                </span>
                <span className="font-medium">
                  {formatINR(Math.round((total * Number.parseFloat(settings.gst_percent ?? "9")) / 100) * 2)}
                </span>
              </div>
              <div className="flex items-center justify-between text-base font-semibold">
                <span>Grand total</span>
                <span>
                  {formatINR(
                    total + Math.round((total * Number.parseFloat(settings.gst_percent ?? "9")) / 100) * 2,
                  )}
                </span>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Button onClick={handleExport} disabled={loading} size="lg" className="w-full">
                {loading ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <>
                    <FileSpreadsheet className="size-4" aria-hidden />
                    <ReceiptText className="size-4" aria-hidden />
                  </>
                )}
                Download Summary + Bill (Excel)
              </Button>
              <Button
                onClick={handlePdfBill}
                disabled={loading}
                size="lg"
                variant="outline"
                className="w-full"
              >
                {loading ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <FileText className="size-4" aria-hidden />
                )}
                Download Bill (PDF)
              </Button>
            </div>
            <p className="text-center text-xs text-muted-foreground">
              Next invoice no: {settings.invoice_prefix}
              {String(Number.parseInt(settings.invoice_counter ?? "1", 10)).padStart(2, "0")}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
