"use client"

import { useMemo, useState } from "react"
import { deleteTrip, updateTrip } from "@/app/actions/trips"
import type { Trip } from "@/lib/db/schema"
import { billSize, formatDateDDMMYYYY, formatINR, serviceLabel, tripFraudFlag } from "@/lib/domain"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { toast } from "sonner"
import { AlertTriangle, Loader2, Pencil, Trash2, X } from "lucide-react"
import { useRouter } from "next/navigation"

const CATEGORY_FILTERS = ["ALL", "JWC EXP", "JWC IMP", "JWR EXP", "JWR IMP", "FLAGGED"] as const

export function TripsClient({ initialTrips }: { initialTrips: Trip[] }) {
  const router = useRouter()
  const [filter, setFilter] = useState<(typeof CATEGORY_FILTERS)[number]>("ALL")
  const [search, setSearch] = useState("")
  const [editingId, setEditingId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<Trip | null>(null)

  const filtered = useMemo(() => {
    return initialTrips.filter((t) => {
      if (filter === "FLAGGED") {
        if (!tripFraudFlag(t)) return false
      } else if (filter !== "ALL" && serviceLabel(t.company, t.direction) !== filter) {
        return false
      }
      if (search) {
        const q = search.toUpperCase()
        if (
          !t.containerNo.includes(q) &&
          !(t.containerNo2 ?? "").includes(q) &&
          !t.fromLocation.includes(q) &&
          !t.toLocation.includes(q)
        )
          return false
      }
      return true
    })
  }, [initialTrips, filter, search])

  const flaggedCount = useMemo(
    () => initialTrips.filter((t) => tripFraudFlag(t) !== null).length,
    [initialTrips],
  )

  const total = useMemo(() => filtered.reduce((s, t) => s + t.rate, 0), [filtered])

  function startEdit(t: Trip) {
    setEditingId(t.id)
    setDraft({ ...t })
  }

  async function saveEdit() {
    if (!draft) return
    setBusy(true)
    try {
      await updateTrip(draft.id, {
        tripDate: draft.tripDate,
        containerNo: draft.containerNo,
        size: draft.size as "40" | "20",
        tripType: draft.tripType as "single" | "double",
        containerNo2: draft.containerNo2,
        fromLocation: draft.fromLocation,
        toLocation: draft.toLocation,
        company: draft.company as "JWC" | "JWR",
        direction: draft.direction as "EXPORT" | "IMPORT",
      })
      toast.success("Trip updated")
      setEditingId(null)
      setDraft(null)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed")
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this trip entry?")) return
    setBusy(true)
    try {
      await deleteTrip(id)
      toast.success("Trip deleted")
      router.refresh()
    } catch {
      toast.error("Delete failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {CATEGORY_FILTERS.map((c) => (
          <Button
            key={c}
            size="sm"
            variant={filter === c ? "default" : "outline"}
            onClick={() => setFilter(c)}
            className={c === "FLAGGED" && flaggedCount > 0 ? "gap-1.5" : undefined}
          >
            {c === "ALL" ? "All" : c === "FLAGGED" ? (
              <>
                <AlertTriangle className="size-3.5" aria-hidden />
                Flagged
                {flaggedCount > 0 && (
                  <span className="ml-0.5 rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-semibold leading-none text-destructive-foreground">
                    {flaggedCount}
                  </span>
                )}
              </>
            ) : c}
          </Button>
        ))}
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search container / location"
          className="ml-auto w-full sm:w-64"
          aria-label="Search trips"
        />
      </div>

      <div className="text-sm text-muted-foreground">
        {filtered.length} trips · Total{" "}
        <span className="font-medium text-foreground">{formatINR(total)}</span>
      </div>

      {/* Edit panel */}
      {editingId !== null && draft && (
        <Card className="border-primary/40">
          <CardContent className="flex flex-col gap-3 py-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Edit trip</span>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  setEditingId(null)
                  setDraft(null)
                }}
                aria-label="Cancel edit"
              >
                <X className="size-4" aria-hidden />
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Input
                type="date"
                value={draft.tripDate}
                onChange={(e) => setDraft({ ...draft, tripDate: e.target.value })}
                aria-label="Trip date"
              />
              <Input
                value={draft.containerNo}
                className="font-mono"
                onChange={(e) =>
                  setDraft({ ...draft, containerNo: e.target.value.toUpperCase() })
                }
                aria-label="Container number"
              />
              <Select
                value={`${draft.size}_${draft.tripType}`}
                onValueChange={(v) => {
                  if (!v) return
                  const [size, tripType] = v.split("_")
                  setDraft({
                    ...draft,
                    size,
                    tripType,
                    containerNo2: tripType === "double" ? draft.containerNo2 : null,
                  })
                }}
              >
                <SelectTrigger aria-label="Size and type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="40_single">40 ft</SelectItem>
                  <SelectItem value="20_single">20 ft single</SelectItem>
                  <SelectItem value="20_double">20 ft double</SelectItem>
                </SelectContent>
              </Select>
              {draft.tripType === "double" && (
                <Input
                  value={draft.containerNo2 ?? ""}
                  className="font-mono"
                  placeholder="2nd container"
                  onChange={(e) =>
                    setDraft({ ...draft, containerNo2: e.target.value.toUpperCase() })
                  }
                  aria-label="Second container number"
                />
              )}
              <Input
                value={draft.fromLocation}
                onChange={(e) =>
                  setDraft({ ...draft, fromLocation: e.target.value.toUpperCase() })
                }
                aria-label="From location"
              />
              <Input
                value={draft.toLocation}
                onChange={(e) =>
                  setDraft({ ...draft, toLocation: e.target.value.toUpperCase() })
                }
                aria-label="To location"
              />
              <Select
                value={draft.company}
                onValueChange={(v) => v && setDraft({ ...draft, company: v })}
              >
                <SelectTrigger aria-label="Company">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="JWC">JWC</SelectItem>
                  <SelectItem value="JWR">JWR</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={draft.direction}
                onValueChange={(v) => v && setDraft({ ...draft, direction: v })}
              >
                <SelectTrigger aria-label="Direction">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="EXPORT">Export</SelectItem>
                  <SelectItem value="IMPORT">Import</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2">
              <Button onClick={saveEdit} disabled={busy}>
                {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
                Save Changes
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Desktop table */}
      <div className="hidden overflow-x-auto rounded-lg border border-border md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Container No</TableHead>
              <TableHead>Size</TableHead>
              <TableHead>From</TableHead>
              <TableHead>To</TableHead>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Rate</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((t) => {
              const flag = tripFraudFlag(t)
              return (
                <TableRow key={t.id} className={flag ? "bg-destructive/5" : undefined}>
                  <TableCell className="whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      {flag && (
                        <span title={flag} className="inline-flex items-center">
                          <AlertTriangle
                            className="size-3.5 shrink-0 text-destructive"
                            aria-label={flag}
                          />
                        </span>
                      )}
                      {formatDateDDMMYYYY(t.tripDate)}
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {t.containerNo}
                    {t.containerNo2 && (
                      <>
                        <br />
                        {t.containerNo2}
                      </>
                    )}
                  </TableCell>
                  <TableCell>{billSize(t.size, t.tripType)}</TableCell>
                  <TableCell>{t.fromLocation}</TableCell>
                  <TableCell>{t.toLocation}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{serviceLabel(t.company, t.direction)}</Badge>
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatINR(t.rate)}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => startEdit(t)}
                        aria-label={`Edit trip ${t.containerNo}`}
                      >
                        <Pencil className="size-4" aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(t.id)}
                        aria-label={`Delete trip ${t.containerNo}`}
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                  No trips found. Scan a trip card to get started.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Mobile cards */}
      <div className="flex flex-col gap-2 md:hidden">
        {filtered.map((t) => {
          const flag = tripFraudFlag(t)
          return (
            <Card key={t.id} className={flag ? "border-destructive/40" : undefined}>
              <CardContent className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-mono text-xs font-medium">
                      {t.containerNo}
                      {t.containerNo2 ? ` +1` : ""}
                    </span>
                    <Badge variant="outline" className="shrink-0">
                      {serviceLabel(t.company, t.direction)}
                    </Badge>
                    {flag && (
                      <span title={flag} className="inline-flex items-center">
                        <AlertTriangle
                          className="size-3.5 shrink-0 text-destructive"
                          aria-label={flag}
                        />
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatDateDDMMYYYY(t.tripDate)} · {billSize(t.size, t.tripType)} ·{" "}
                    {t.fromLocation} → {t.toLocation}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <span className="text-sm font-semibold">{formatINR(t.rate)}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => startEdit(t)}
                    aria-label={`Edit trip ${t.containerNo}`}
                  >
                    <Pencil className="size-4" aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDelete(t.id)}
                    aria-label={`Delete trip ${t.containerNo}`}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </div>
              </CardContent>
            </Card>
          )
        })}
        {filtered.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No trips found. Scan a trip card to get started.
          </p>
        )}
      </div>
    </div>
  )
}
