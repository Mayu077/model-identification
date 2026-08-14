"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { updateRate } from "@/app/actions/trips"
import { updateSetting, changeOwnerPassword } from "@/app/actions/settings"
import type { Rate } from "@/lib/db/schema"
import { formatINR } from "@/lib/domain"
import { DEFAULT_IMAGE_RETENTION_DAYS, IMAGE_RETENTION_SETTING_KEY } from "@/lib/retention"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"
import { Eye, EyeOff, Loader2 } from "lucide-react"
import { LetterheadCard } from "@/components/settings/letterhead-card"

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
  { key: "bill_to", label: "Bill to (customer name)" },
  { key: "billing_address", label: "Customer billing address" },
  { key: "vehicle_number", label: "Vehicle number" },
]

const BANK_FIELDS: Array<{ key: string; label: string }> = [
  { key: "bank_account_name", label: "Account name" },
  { key: "bank_name", label: "Bank name" },
  { key: "bank_account_no", label: "Account number" },
  { key: "bank_ifsc", label: "IFSC code" },
  { key: "bank_branch", label: "Branch" },
  { key: "authorized_signatory", label: "Authorized signatory name" },
]

const EMPTY_PW = { currentPassword: "", newPassword: "", confirmPassword: "" }

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
  const [pwDraft, setPwDraft] = useState(EMPTY_PW)
  const [pwBusy, setPwBusy] = useState(false)
  const [showPw, setShowPw] = useState(false)

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

  async function savePassword() {
    if (!pwDraft.currentPassword || !pwDraft.newPassword || !pwDraft.confirmPassword) {
      toast.error("Fill in all three password fields")
      return
    }
    if (pwDraft.newPassword !== pwDraft.confirmPassword) {
      toast.error("New passwords do not match")
      return
    }
    setPwBusy(true)
    try {
      await changeOwnerPassword(pwDraft)
      toast.success("Password changed")
      setPwDraft(EMPTY_PW)
      setShowPw(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to change password")
    } finally {
      setPwBusy(false)
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

      <LetterheadCard currentUrl={settings.letterhead_url} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Bank &amp; signatory (shown on PDF bill)</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {BANK_FIELDS.map((f) => (
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
            Save Bank Details
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Change password</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground text-pretty">
            Changing your password will sign out all other devices logged in with the old password.
            This session will stay active.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="pw-current" className="text-xs">Current password</Label>
              <div className="relative">
                <Input
                  id="pw-current"
                  type={showPw ? "text" : "password"}
                  autoComplete="current-password"
                  value={pwDraft.currentPassword}
                  onChange={(e) => setPwDraft((d) => ({ ...d, currentPassword: e.target.value }))}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={showPw ? "Hide passwords" : "Show passwords"}
                >
                  {showPw ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
                </button>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pw-new" className="text-xs">New password</Label>
              <Input
                id="pw-new"
                type={showPw ? "text" : "password"}
                autoComplete="new-password"
                value={pwDraft.newPassword}
                onChange={(e) => setPwDraft((d) => ({ ...d, newPassword: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pw-confirm" className="text-xs">Confirm new password</Label>
              <Input
                id="pw-confirm"
                type={showPw ? "text" : "password"}
                autoComplete="new-password"
                value={pwDraft.confirmPassword}
                onChange={(e) => setPwDraft((d) => ({ ...d, confirmPassword: e.target.value }))}
              />
            </div>
          </div>
          <div className="flex items-center justify-between gap-4">
            <p className="text-xs text-muted-foreground">Minimum 10 characters</p>
            <Button onClick={savePassword} disabled={pwBusy} className="self-end">
              {pwBusy && <Loader2 className="size-4 animate-spin" aria-hidden />}
              Change Password
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
