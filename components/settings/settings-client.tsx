"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { updateRate } from "@/app/actions/trips"
import { updateSetting } from "@/app/actions/settings"
import type { Rate } from "@/lib/db/schema"
import { formatINR } from "@/lib/domain"
import { DEFAULT_IMAGE_RETENTION_DAYS, IMAGE_RETENTION_SETTING_KEY } from "@/lib/retention"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"

const KIND_LABELS: Record<string, string> = {
  "40": "40 ft",
  "20_single": "20 ft single",
  "20_double": "20 ft double",
}

const SETTING_FIELDS: Array<{ key: string; label: string }> = [
  { key: "business_name", label: "Business name" },
  { key: "business_tagline", label: "Tagline" },
  { key: "business_address", label: "Address" },
  { key: "business_mobile", label: "Mobile" },
  { key: "business_email", label: "Email" },
  { key: "gstin", label: "GSTIN" },
  { key: "pan", label: "PAN" },
  { key: "invoice_prefix", label: "Invoice prefix" },
  { key: "invoice_counter", label: "Next invoice number" },
  { key: "gst_percent", label: "GST % (CGST and SGST each)" },
  { key: "bill_to", label: "Bill to (customer)" },
]

export function SettingsClient({
  rates,
  settings,
}: {
  rates: Rate[]
  settings: Record<string, string>
}) {
  const router = useRouter()
  const [rateDrafts, setRateDrafts] = useState<Record<number, string>>({})
  const [settingDrafts, setSettingDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  async function saveRates() {
    const changes = Object.entries(rateDrafts).filter(([id, v]) => {
      const orig = rates.find((r) => r.id === Number.parseInt(id, 10))
      return orig && Number.parseInt(v, 10) !== orig.rate && Number.parseInt(v, 10) > 0
    })
    if (changes.length === 0) {
      toast.info("No rate changes to save")
      return
    }
    setBusy(true)
    try {
      for (const [id, v] of changes) {
        await updateRate(Number.parseInt(id, 10), Number.parseInt(v, 10))
      }
      toast.success(`${changes.length} rates updated`)
      setRateDrafts({})
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update rates")
    } finally {
      setBusy(false)
    }
  }

  async function saveSettings() {
    const changes = Object.entries(settingDrafts).filter(
      ([k, v]) => v !== (settings[k] ?? ""),
    )
    if (changes.length === 0) {
      toast.info("No changes to save")
      return
    }
    setBusy(true)
    try {
      for (const [k, v] of changes) {
        await updateSetting(k, v)
      }
      toast.success("Business details updated")
      setSettingDrafts({})
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update settings")
    } finally {
      setBusy(false)
    }
  }

  // Group rates by company+direction
  const groups = new Map<string, Rate[]>()
  for (const r of rates) {
    const key = `${r.company} ${r.direction}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(r)
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Trip rates</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {[...groups.entries()].map(([group, list]) => (
              <div key={group} className="rounded-lg border border-border p-3">
                <p className="mb-2 text-sm font-medium">{group}</p>
                <div className="flex flex-col gap-2">
                  {list.map((r) => (
                    <div key={r.id} className="flex items-center justify-between gap-2">
                      <Label htmlFor={`rate-${r.id}`} className="text-sm text-muted-foreground">
                        {KIND_LABELS[r.tripKind] ?? r.tripKind}
                      </Label>
                      <Input
                        id={`rate-${r.id}`}
                        type="number"
                        inputMode="numeric"
                        className="w-28 text-right"
                        value={rateDrafts[r.id] ?? String(r.rate)}
                        onChange={(e) =>
                          setRateDrafts((d) => ({ ...d, [r.id]: e.target.value }))
                        }
                        aria-label={`${group} ${KIND_LABELS[r.tripKind]} rate, currently ${formatINR(r.rate)}`}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <Button onClick={saveRates} disabled={busy} className="self-end">
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
            Save Rates
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Business details (used on the bill)</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {SETTING_FIELDS.map((f) => (
              <div key={f.key} className="flex flex-col gap-1.5">
                <Label htmlFor={`s-${f.key}`} className="text-xs">
                  {f.label}
                </Label>
                <Input
                  id={`s-${f.key}`}
                  value={settingDrafts[f.key] ?? settings[f.key] ?? ""}
                  onChange={(e) =>
                    setSettingDrafts((d) => ({ ...d, [f.key]: e.target.value }))
                  }
                />
              </div>
            ))}
          </div>
          <Button onClick={saveSettings} disabled={busy} className="self-end">
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
            Save Details
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Scanned card images</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground text-pretty">
            Uploaded trip cards are kept so you can check a saved entry against the original
            handwriting. After this many days the photo is deleted automatically — the trip
            entries themselves are never touched. Set 0 to keep photos indefinitely.
          </p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`s-${IMAGE_RETENTION_SETTING_KEY}`} className="text-xs">
              Delete card photos after (days)
            </Label>
            <Input
              id={`s-${IMAGE_RETENTION_SETTING_KEY}`}
              type="number"
              inputMode="numeric"
              min={0}
              max={3650}
              className="w-32"
              value={
                settingDrafts[IMAGE_RETENTION_SETTING_KEY] ??
                settings[IMAGE_RETENTION_SETTING_KEY] ??
                String(DEFAULT_IMAGE_RETENTION_DAYS)
              }
              onChange={(e) =>
                setSettingDrafts((d) => ({ ...d, [IMAGE_RETENTION_SETTING_KEY]: e.target.value }))
              }
            />
          </div>
          <Button onClick={saveSettings} disabled={busy} className="self-end">
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
            Save Retention
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
