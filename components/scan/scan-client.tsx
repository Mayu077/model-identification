"use client"

import { useRef, useState } from "react"
import { saveTrips, type SaveTripsResult } from "@/app/actions/trips"
import { containerWarning, type ExtractedTrip } from "@/lib/domain"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { RowCrop, type RowBox } from "@/components/scan/row-crop"
import { toast } from "sonner"
import { Camera, Loader2, ScanLine, Trash2, TriangleAlert, Upload } from "lucide-react"

type ReviewTrip = ExtractedTrip & {
  warnings: string[]
  isDuplicate: boolean
  include: boolean
  /** Where on the card this row was read from, for the crop preview. */
  sourceBox: RowBox | null
}

/** Shape the scan API returns for one extracted row. */
type ScannedTrip = ExtractedTrip & {
  warnings: string[]
  isDuplicate: boolean
  sourceBox: RowBox | null
}

interface ScanJobStatus {
  status: string
  result?: { trips?: ScannedTrip[]; modelUsed?: string; provider?: string }
  errorMessage?: string
  hasImage?: boolean
  imageWidth?: number | null
  imageHeight?: number | null
}

export function ScanClient() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [saving, setSaving] = useState(false)
  const [rows, setRows] = useState<ReviewTrip[] | null>(null)
  const [modelUsed, setModelUsed] = useState<string | null>(null)
  const [result, setResult] = useState<SaveTripsResult | null>(null)
  // Set once the scan finishes, so each review row can show its own strip of the
  // stored card. Served through /api/scan/image, not the local object URL: the
  // stored copy is the exact image the model read and the one that survives a
  // page reload.
  const [card, setCard] = useState<{ jobId: string; src: string; aspect: number | null } | null>(null)

  // Phone photos are often 8-15MB which exceeds the server upload limit and
  // caused "Unexpected token" errors (server returned an HTML error page, not
  // JSON). Resize in the browser before uploading — but only when there is
  // something to resize.
  const MAX_DIM = 2048
  // Below this on the long edge, a container number is roughly ten pixels per
  // character and misreads start appearing. A WhatsApp-forwarded photo lands at
  // 720x1280, which is exactly where this bites.
  const LOW_RES_DIM = 1400

  async function prepareImage(file: File): Promise<{ blob: Blob; width: number; height: number }> {
    const bitmap = await createImageBitmap(file)
    const { width, height } = bitmap
    // Re-encoding a photo that is already within bounds throws away detail for
    // nothing — and it is the small, already-compressed photos that need every
    // pixel they have left. Only touch the file when it is genuinely too big.
    if (Math.max(width, height) <= MAX_DIM && file.size <= 6 * 1024 * 1024) {
      bitmap.close?.()
      return { blob: file, width, height }
    }
    const scale = Math.min(1, MAX_DIM / Math.max(width, height))
    const canvas = document.createElement("canvas")
    canvas.width = Math.round(width * scale)
    canvas.height = Math.round(height * scale)
    const ctx = canvas.getContext("2d")
    if (!ctx) return { blob: file, width, height }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close?.()
    // 0.92 rather than 0.85: this is handwriting, where JPEG ringing around thin
    // strokes is the difference between a 6 and a 0, and the extra bytes are
    // nothing next to a 10MB limit.
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.92),
    )
    return { blob: blob ?? file, width: canvas.width, height: canvas.height }
  }

  async function handleFile(file: File) {
    setResult(null)
    setRows(null)
    setCard(null)
    setPreview(URL.createObjectURL(file))
    setScanning(true)
    try {
      let upload: Blob = file
      try {
        const prepared = await prepareImage(file)
        upload = prepared.blob
        if (Math.max(prepared.width, prepared.height) < LOW_RES_DIM) {
          // Said up front, not after a failed read: the owner can retake the
          // photo in ten seconds, and finding out at the end of a 40s scan that
          // the picture was never good enough is the frustrating version.
          toast.warning(
            `This photo is only ${prepared.width}×${prepared.height}. Container numbers may be misread — check each row carefully, or send the original photo instead of a WhatsApp copy.`,
            { duration: 8000 },
          )
        }
      } catch {
        // If compression fails (very old browser), fall back to original file
      }
      const formData = new FormData()
      formData.append("image", upload, "tripcard.jpg")
      const res = await fetch("/api/scan", { method: "POST", body: formData })
      // Catch an expired session before trying to parse the body: a redirect to
      // the HTML sign-in page arrives here as a followed 200, which is not JSON.
      if (res.redirected || res.status === 401 || res.status === 403) {
        throw new Error("Your session expired — please sign in again, then retry this upload.")
      }
      let data: { error?: string; trips?: ScannedTrip[] }
      try {
        data = await res.json()
      } catch {
        throw new Error(
          res.status === 413
            ? "Image too large — try again, it will be compressed automatically"
            : `Scan failed (server error ${res.status}) — please try again`,
        )
      }
      if (!res.ok) throw new Error(data.error || "Scan failed")
      const queued = data as typeof data & { jobId?: string; status?: string }
      if (!queued.jobId) throw new Error("Scan job was not created")
      let job: ScanJobStatus = { status: queued.status ?? "queued" }
      // Extraction is normally 10-20s now that Gemini's thinking budget is off,
      // but a card that has to rotate through several busy models can still take
      // a couple of minutes, and the server allows up to 300s. Poll fast at first
      // so the common case feels immediate, then settle down.
      for (let attempt = 0; attempt < 170 && ["queued", "processing"].includes(job.status); attempt++) {
        await new Promise((resolve) => setTimeout(resolve, attempt < 20 ? 1000 : 2000))
        const statusResponse = await fetch(`/api/scan?id=${encodeURIComponent(queued.jobId)}`, { cache: "no-store" })
        if (statusResponse.redirected || [401, 403].includes(statusResponse.status)) {
          throw new Error("Your session expired while the card was being read — sign in again and the result will still be here.")
        }
        job = await statusResponse.json().catch(() => {
          throw new Error("Could not check scan status — please retry.")
        })
        if (!statusResponse.ok) throw new Error(job.errorMessage || "Could not check scan status")
      }
      if (job.status === "failed") throw new Error(job.errorMessage || "Scan extraction failed")
      if (job.status !== "succeeded") throw new Error("Scan is taking longer than expected. You can safely retry.")
      data.trips = job.result?.trips ?? []
      setModelUsed(job.result?.modelUsed ?? null)
      const trips: ReviewTrip[] = (data.trips ?? []).map((t) => ({
        ...t,
        sourceBox: t.sourceBox ?? null,
        include: !t.isDuplicate,
      }))
      if (trips.length === 0) {
        toast.warning("No trips found in this image. Try a clearer photo.")
      }
      if (job.hasImage) {
        setCard({
          jobId: queued.jobId,
          src: `/api/scan/image/${encodeURIComponent(queued.jobId)}`,
          // Without both dimensions the crop cannot be sized to the row, so the
          // preview falls back to its magnified mode instead of guessing.
          aspect:
            job.imageWidth && job.imageHeight ? job.imageWidth / job.imageHeight : null,
        })
      }
      setRows(trips)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Scan failed")
    } finally {
      setScanning(false)
    }
  }

  function updateRow(i: number, patch: Partial<ReviewTrip>) {
    setRows((prev) =>
      prev ? prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)) : prev,
    )
  }

  function removeRow(i: number) {
    setRows((prev) => (prev ? prev.filter((_, idx) => idx !== i) : prev))
  }

  async function handleSave() {
    if (!rows) return
    const toSave = rows.filter((r) => r.include)
    if (toSave.length === 0) {
      toast.warning("No entries selected to save")
      return
    }
    setSaving(true)
    try {
      const res = await saveTrips(
        toSave.map(({ warnings: _w, isDuplicate: _d, include: _i, sourceBox, ...t }) => ({
          ...t,
          // Keep the provenance with the saved trip so an owner can re-open the
          // exact strip of the card later, not just at review time.
          scanJobId: card?.jobId ?? null,
          sourceBox,
        })),
      )
      setResult(res)
      if (res.errors.length > 0) {
        toast.error(`${res.errors.length} entries failed — see below`)
      } else {
        toast.success(
          `Saved ${res.saved} trips${res.skippedDuplicates > 0 ? `, skipped ${res.skippedDuplicates} duplicates` : ""}`,
        )
        setRows(null)
        setPreview(null)
        setCard(null)
        setModelUsed(null)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Upload area */}
      {!rows && (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-10">
            {scanning ? (
              <>
                {preview && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={preview || "/placeholder.svg"}
                    alt="Trip card being scanned"
                    className="max-h-64 rounded-md border border-border object-contain"
                  />
                )}
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Reading trip card with AI…
                </div>
              </>
            ) : (
              <>
                <div className="rounded-full bg-primary/10 p-4 text-primary">
                  <Upload className="size-8" aria-hidden />
                </div>
                <div className="text-center">
                  <p className="font-medium">Upload trip card photo</p>
                  <p className="text-sm text-muted-foreground">
                    Take a clear, well-lit photo of the handwritten card or terminal receipt
                  </p>
                </div>
                <div className="flex gap-3">
                  <Button
                    variant="outline"
                    onClick={() => cameraInputRef.current?.click()}
                  >
                    <Camera className="mr-2 size-4" aria-hidden />
                    Take Photo
                  </Button>
                  <Button onClick={() => fileInputRef.current?.click()}>
                    <Upload className="mr-2 size-4" aria-hidden />
                    Choose File
                  </Button>
                </div>
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="sr-only"
                  aria-label="Take photo with camera"
                  onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
                />
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  aria-label="Upload trip card image"
                  onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
                />
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Review table */}
      {rows && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span>
                {rows.length} entries found ·{" "}
                <span className="text-foreground font-medium">
                  {rows.filter((r) => r.include).length} selected
                </span>
                {rows.some((r) => r.isDuplicate) && (
                  <> · {rows.filter((r) => r.isDuplicate).length} duplicates flagged</>
                )}
              </span>
              {modelUsed && (
                <Badge variant="outline" className="font-mono text-xs font-normal border-primary/30 text-primary bg-primary/5">
                  AI: {modelUsed}
                </Badge>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setRows(null)
                  setPreview(null)
                  setCard(null)
                  setModelUsed(null)
                }}
              >
                Rescan
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving && <Loader2 className="size-4 animate-spin" aria-hidden />}
                Save {rows.filter((r) => r.include).length} Trips
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            {rows.map((row, i) => (
              <Card
                key={i}
                className={row.isDuplicate ? "opacity-70 border-dashed" : undefined}
              >
                <CardContent className="flex flex-col gap-3 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={row.include}
                        onChange={(e) => updateRow(i, { include: e.target.checked })}
                        className="size-4 accent-primary"
                        aria-label={`Include trip ${row.containerNo}`}
                      />
                      <span className="font-mono text-sm font-medium">
                        {row.containerNo}
                      </span>
                      {row.isDuplicate && (
                        <Badge variant="secondary">Already saved</Badge>
                      )}
                      <Badge variant="outline">
                        {row.company} {row.direction === "EXPORT" ? "EXP" : "IMP"}
                      </Badge>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeRow(i)}
                      aria-label={`Remove trip ${row.containerNo}`}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </div>

                  {row.warnings.length > 0 && (
                    <div className="flex items-start gap-2 rounded-md bg-accent/10 px-3 py-2 text-xs text-accent-foreground">
                      <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-accent" aria-hidden />
                      <ul className="flex flex-col gap-0.5">
                        {row.warnings.map((w, wi) => (
                          <li key={wi}>{w}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {card && (
                    <RowCrop
                      src={card.src}
                      aspect={card.aspect}
                      box={row.sourceBox}
                      label={row.containerNo}
                    />
                  )}

                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <div className="flex flex-col gap-1">
                      <label className="text-xs text-muted-foreground" htmlFor={`date-${i}`}>
                        Date
                      </label>
                      <Input
                        id={`date-${i}`}
                        type="date"
                        value={row.tripDate}
                        onChange={(e) => updateRow(i, { tripDate: e.target.value })}
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs text-muted-foreground" htmlFor={`cn-${i}`}>
                        Container No
                      </label>
                      <Input
                        id={`cn-${i}`}
                        value={row.containerNo}
                        aria-invalid={containerWarning(row.containerNo) !== null}
                        className={
                          containerWarning(row.containerNo)
                            ? "font-mono border-destructive text-destructive focus-visible:ring-destructive"
                            : "font-mono"
                        }
                        onChange={(e) =>
                          updateRow(i, { containerNo: e.target.value.toUpperCase() })
                        }
                      />
                      {containerWarning(row.containerNo) && (
                        <p className="text-xs text-destructive">Check digit failed — verify</p>
                      )}
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs text-muted-foreground" htmlFor={`size-${i}`}>
                        Size
                      </label>
                      <Select
                        value={`${row.size}_${row.tripType}`}
                        onValueChange={(v) => {
                          if (!v) return
                          const [size, tripType] = v.split("_") as [
                            "40" | "20",
                            "single" | "double",
                          ]
                          updateRow(i, {
                            size,
                            tripType,
                            containerNo2: tripType === "double" ? row.containerNo2 : null,
                          })
                        }}
                      >
                        <SelectTrigger id={`size-${i}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="40_single">40 ft</SelectItem>
                          <SelectItem value="20_single">20 ft single</SelectItem>
                          <SelectItem value="20_double">20 ft double</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {row.tripType === "double" && (
                      <div className="flex flex-col gap-1">
                        <label className="text-xs text-muted-foreground" htmlFor={`cn2-${i}`}>
                          2nd Container
                        </label>
                        <Input
                          id={`cn2-${i}`}
                          value={row.containerNo2 ?? ""}
                          aria-invalid={!!row.containerNo2 && containerWarning(row.containerNo2) !== null}
                          className={
                            row.containerNo2 && containerWarning(row.containerNo2)
                              ? "font-mono border-destructive text-destructive focus-visible:ring-destructive"
                              : "font-mono"
                          }
                          onChange={(e) =>
                            updateRow(i, { containerNo2: e.target.value.toUpperCase() })
                          }
                        />
                        {row.containerNo2 && containerWarning(row.containerNo2) && (
                          <p className="text-xs text-destructive">Check digit failed — verify</p>
                        )}
                      </div>
                    )}
                    <div className="flex flex-col gap-1">
                      <label className="text-xs text-muted-foreground" htmlFor={`from-${i}`}>
                        From
                      </label>
                      <Input
                        id={`from-${i}`}
                        value={row.fromLocation}
                        onChange={(e) =>
                          updateRow(i, { fromLocation: e.target.value.toUpperCase() })
                        }
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs text-muted-foreground" htmlFor={`to-${i}`}>
                        To
                      </label>
                      <Input
                        id={`to-${i}`}
                        value={row.toLocation}
                        onChange={(e) =>
                          updateRow(i, { toLocation: e.target.value.toUpperCase() })
                        }
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs text-muted-foreground" htmlFor={`co-${i}`}>
                        Company
                      </label>
                      <Select
                        value={row.company}
                        onValueChange={(v) => updateRow(i, { company: v as "JWC" | "JWR" })}
                      >
                        <SelectTrigger id={`co-${i}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="JWC">JWC</SelectItem>
                          <SelectItem value="JWR">JWR</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs text-muted-foreground" htmlFor={`dir-${i}`}>
                        Direction
                      </label>
                      <Select
                        value={row.direction}
                        onValueChange={(v) =>
                          updateRow(i, { direction: v as "EXPORT" | "IMPORT" })
                        }
                      >
                        <SelectTrigger id={`dir-${i}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="EXPORT">Export</SelectItem>
                          <SelectItem value="IMPORT">Import</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Save result with errors */}
      {result && result.errors.length > 0 && (
        <Card className="border-destructive/50">
          <CardContent className="py-4">
            <p className="mb-2 text-sm font-medium text-destructive">
              {result.errors.length} entries could not be saved:
            </p>
            <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
              {result.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
