"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { addExpense, deleteExpense } from "@/app/actions/expenses"
import type { Expense } from "@/lib/db/schema"
import {
  EXPENSE_CATEGORIES,
  formatDateDDMMYYYY,
  formatINR,
  type ExtractedExpense,
} from "@/lib/domain"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { toast } from "sonner"
import { ImagePlus, Loader2, Plus, Send, Sparkles, Trash2, X } from "lucide-react"

const CATEGORY_COLORS: Record<string, string> = {
  Diesel: "bg-chart-1/15 text-chart-1",
  "Driver Advance": "bg-chart-2/15 text-chart-2",
  "Driver Salary": "bg-chart-3/15 text-chart-3",
  "Repair & Maintenance": "bg-chart-4/15 text-chart-4",
  Others: "bg-muted text-muted-foreground",
}

type PendingExpense = ExtractedExpense & { source: "ai_text" | "ai_image" }

export function ExpensesClient({ initialExpenses }: { initialExpenses: Expense[] }) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState("")
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [pending, setPending] = useState<PendingExpense | null>(null)
  const [showManual, setShowManual] = useState(false)
  const [busy, setBusy] = useState(false)

  // Manual form state
  const [mDate, setMDate] = useState(new Date().toISOString().slice(0, 10))
  const [mCategory, setMCategory] = useState<string>("Diesel")
  const [mAmount, setMAmount] = useState("")
  const [mDesc, setMDesc] = useState("")

  async function handleAiSubmit() {
    if (!message.trim() && !imageFile) {
      toast.warning("Type a message or attach a payment screenshot")
      return
    }
    setAiBusy(true)
    try {
      const formData = new FormData()
      if (message.trim()) formData.append("text", message.trim())
      if (imageFile) formData.append("image", imageFile)
      const res = await fetch("/api/expense-ai", { method: "POST", body: formData })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "AI failed")
      setPending({ ...data.expense, source: data.source })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "AI extraction failed")
    } finally {
      setAiBusy(false)
    }
  }

  async function confirmPending() {
    if (!pending) return
    setBusy(true)
    try {
      await addExpense({
        expenseDate: pending.expenseDate,
        category: pending.category,
        amount: pending.amount,
        description: pending.description ?? null,
        source: pending.source,
      })
      toast.success(`${formatINR(pending.amount)} added to ${pending.category}`)
      setPending(null)
      setMessage("")
      setImageFile(null)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed")
    } finally {
      setBusy(false)
    }
  }

  async function handleManualAdd() {
    const amount = Number.parseInt(mAmount, 10)
    if (!amount || amount <= 0) {
      toast.warning("Enter a valid amount")
      return
    }
    setBusy(true)
    try {
      await addExpense({
        expenseDate: mDate,
        category: mCategory as (typeof EXPENSE_CATEGORIES)[number],
        amount,
        description: mDesc.trim() || null,
        source: "manual",
      })
      toast.success(`${formatINR(amount)} added to ${mCategory}`)
      setMAmount("")
      setMDesc("")
      setShowManual(false)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed")
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this expense?")) return
    try {
      await deleteExpense(id)
      toast.success("Expense deleted")
      router.refresh()
    } catch {
      toast.error("Delete failed")
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* AI entry box */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="size-4 text-primary" aria-hidden />
            AI expense entry
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing &&
                e.keyCode !== 229
              ) {
                e.preventDefault()
                handleAiSubmit()
              }
            }}
            placeholder={'e.g. "1000rs driver advance" or "paid 3500 for tyre puncture yesterday" — or attach a GPay/PhonePe screenshot'}
            rows={2}
          />
          {imageFile && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <ImagePlus className="size-4" aria-hidden />
              <span className="truncate">{imageFile.name}</span>
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                onClick={() => setImageFile(null)}
                aria-label="Remove attached image"
              >
                <X className="size-3.5" aria-hidden />
              </Button>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
              <ImagePlus className="size-4" aria-hidden />
              Screenshot
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="sr-only"
              aria-label="Attach payment screenshot"
              onChange={(e) => e.target.files?.[0] && setImageFile(e.target.files[0])}
            />
            <Button size="sm" onClick={handleAiSubmit} disabled={aiBusy} className="ml-auto">
              {aiBusy ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Send className="size-4" aria-hidden />
              )}
              Extract
            </Button>
          </div>

          {/* Pending AI-extracted expense for confirmation */}
          {pending && (
            <div className="flex flex-col gap-3 rounded-lg border border-primary/40 bg-primary/5 p-3">
              <p className="text-sm font-medium">Confirm expense</p>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="p-date" className="text-xs">Date</Label>
                  <Input
                    id="p-date"
                    type="date"
                    value={pending.expenseDate}
                    onChange={(e) => setPending({ ...pending, expenseDate: e.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="p-cat" className="text-xs">Category</Label>
                  <Select
                    value={pending.category}
                    onValueChange={(v) =>
                      setPending({ ...pending, category: v as PendingExpense["category"] })
                    }
                  >
                    <SelectTrigger id="p-cat">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {EXPENSE_CATEGORIES.map((c) => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="p-amt" className="text-xs">Amount (₹)</Label>
                  <Input
                    id="p-amt"
                    type="number"
                    value={pending.amount}
                    onChange={(e) =>
                      setPending({ ...pending, amount: Number.parseInt(e.target.value || "0", 10) })
                    }
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="p-desc" className="text-xs">Description</Label>
                  <Input
                    id="p-desc"
                    value={pending.description ?? ""}
                    onChange={(e) => setPending({ ...pending, description: e.target.value })}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setPending(null)}>
                  Cancel
                </Button>
                <Button size="sm" onClick={confirmPending} disabled={busy}>
                  {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
                  Save Expense
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Manual add */}
      <div>
        <Button variant="outline" size="sm" onClick={() => setShowManual((s) => !s)}>
          <Plus className="size-4" aria-hidden />
          Add manually
        </Button>
        {showManual && (
          <Card className="mt-3">
            <CardContent className="flex flex-col gap-3 py-4">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="m-date" className="text-xs">Date</Label>
                  <Input id="m-date" type="date" value={mDate} onChange={(e) => setMDate(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="m-cat" className="text-xs">Category</Label>
                  <Select value={mCategory} onValueChange={(v) => v && setMCategory(v)}>
                    <SelectTrigger id="m-cat">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {EXPENSE_CATEGORIES.map((c) => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="m-amt" className="text-xs">Amount (₹)</Label>
                  <Input
                    id="m-amt"
                    type="number"
                    inputMode="numeric"
                    value={mAmount}
                    onChange={(e) => setMAmount(e.target.value)}
                    placeholder="0"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="m-desc" className="text-xs">Description</Label>
                  <Input
                    id="m-desc"
                    value={mDesc}
                    onChange={(e) => setMDesc(e.target.value)}
                    placeholder="Optional note"
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <Button size="sm" onClick={handleManualAdd} disabled={busy}>
                  {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
                  Save Expense
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Expense list */}
      <div className="flex flex-col gap-2">
        {initialExpenses.map((e) => (
          <Card key={e.id}>
            <CardContent className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className={CATEGORY_COLORS[e.category] ?? CATEGORY_COLORS.Others} variant="secondary">
                    {e.category}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {formatDateDDMMYYYY(e.expenseDate)}
                  </span>
                  {e.source !== "manual" && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Sparkles className="size-3" aria-hidden /> AI
                    </span>
                  )}
                </div>
                {e.description && (
                  <p className="mt-1 truncate text-sm text-muted-foreground">{e.description}</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <span className="text-sm font-semibold">{formatINR(e.amount)}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleDelete(e.id)}
                  aria-label={`Delete expense of ${formatINR(e.amount)}`}
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
        {initialExpenses.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No expenses logged yet.
          </p>
        )}
      </div>
    </div>
  )
}
