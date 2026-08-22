"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Camera, CheckCircle2, Clock3, Loader2, Upload } from "lucide-react"
import { toast } from "sonner"
import type { DriverUploadRequest } from "@/app/actions/scan-requests"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { formatDateDDMMYYYY } from "@/lib/domain"

const MAX_DIMENSION = 2048

type DocumentType = "receipt" | "trip_card"

function statusCopy(status: string): { label: string; detail: string } {
  switch (status) {
    case "uploaded": return { label: "Waiting", detail: "Waiting for the owner to scan it" }
    case "queued":
    case "processing": return { label: "Scanning", detail: "The owner has started scanning it" }
    case "succeeded": return { label: "Review", detail: "The scan is ready for the owner to review" }
    case "completed": return { label: "Added", detail: "The owner added the trip entries" }
    case "rejected": return { label: "Closed", detail: "The owner closed this upload" }
    case "failed": return { label: "Retry needed", detail: "The scan failed; the owner can try again" }
    default: return { label: status, detail: "Request updated" }
  }
}

async function prepareImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  if (Math.max(bitmap.width, bitmap.height) <= MAX_DIMENSION && file.size <= 6 * 1024 * 1024) {
    bitmap.close?.()
    return file
  }
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement("canvas")
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const context = canvas.getContext("2d")
  if (!context) {
    bitmap.close?.()
    return file
  }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close?.()
  return await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob ?? file), "image/jpeg", 0.92))
}

export function DriverUploadClient({ requests }: { requests: DriverUploadRequest[] }) {
  const router = useRouter()
  const fileInput = useRef<HTMLInputElement>(null)
  const cameraInput = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [documentType, setDocumentType] = useState<DocumentType>("trip_card")
  const [requestedDate, setRequestedDate] = useState("")
  const [notes, setNotes] = useState("")
  const [uploading, setUploading] = useState(false)

  function choose(next: File) {
    if (preview) URL.revokeObjectURL(preview)
    setFile(next)
    setPreview(URL.createObjectURL(next))
  }

  function clearForm() {
    if (preview) URL.revokeObjectURL(preview)
    setFile(null)
    setPreview(null)
    setRequestedDate("")
    setNotes("")
    if (fileInput.current) fileInput.current.value = ""
    if (cameraInput.current) cameraInput.current.value = ""
  }

  async function submit() {
    if (!file) return toast.error("Take a photo or choose an image first")
    setUploading(true)
    try {
      let image: Blob = file
      try { image = await prepareImage(file) } catch { /* server validates the original */ }
      const formData = new FormData()
      formData.append("image", image, "driver-upload.jpg")
      formData.append("documentType", documentType)
      formData.append("requestedTripDate", requestedDate)
      formData.append("notes", notes)
      const response = await fetch("/api/scan", { method: "POST", body: formData })
      const data = await response.json().catch(() => ({ error: "Upload failed" }))
      if (!response.ok) throw new Error(data.error || "Upload failed")
      toast.success(data.duplicate ? "This image was already sent" : "Sent to the owner for scanning")
      clearForm()
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed")
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Send a trip document</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Upload the image only. The owner will scan it, check the details, and add the trips.
          </p>

          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="Document selected for upload" className="max-h-72 w-full rounded-md border border-border object-contain" />
          ) : (
            <div className="flex min-h-40 items-center justify-center rounded-md border border-dashed border-border bg-muted/30">
              <Upload className="size-8 text-muted-foreground" aria-hidden />
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="document-type">Document type</Label>
              <Select value={documentType} onValueChange={(value) => setDocumentType(value as DocumentType)}>
                <SelectTrigger id="document-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="trip_card">Trip card</SelectItem>
                  <SelectItem value="receipt">Terminal receipt</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                The owner will keep the date printed on this {documentType === "receipt" ? "receipt" : "trip card"}.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="requested-date">Different trip date? (optional)</Label>
              <Input id="requested-date" type="date" value={requestedDate} onChange={(event) => setRequestedDate(event.target.value)} />
              <p className="text-xs text-muted-foreground">Use this only to ask the owner to use another date.</p>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="upload-notes">Note for owner (optional)</Label>
            <Textarea id="upload-notes" rows={3} maxLength={500} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Example: Receipt date is unclear; please use 03-08-2026" />
          </div>

          <div className="flex flex-wrap gap-3">
            <Button type="button" variant="outline" disabled={uploading} onClick={() => cameraInput.current?.click()}>
              <Camera className="size-4" aria-hidden /> Take photo
            </Button>
            <Button type="button" variant="outline" disabled={uploading} onClick={() => fileInput.current?.click()}>
              <Upload className="size-4" aria-hidden /> Choose image
            </Button>
            <Button type="button" disabled={uploading || !file} onClick={submit}>
              {uploading && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {uploading ? "Sending..." : "Send to owner"}
            </Button>
          </div>
          <input ref={cameraInput} className="sr-only" type="file" accept="image/*" capture="environment" aria-label="Take a document photo" onChange={(event) => event.target.files?.[0] && choose(event.target.files[0])} />
          <input ref={fileInput} className="sr-only" type="file" accept="image/*" aria-label="Choose a document image" onChange={(event) => event.target.files?.[0] && choose(event.target.files[0])} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">My uploads</CardTitle></CardHeader>
        <CardContent>
          {requests.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No images sent yet.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {requests.map((request) => {
                const copy = statusCopy(request.status)
                return (
                  <li key={request.id} className="flex gap-3 py-3">
                    {request.hasImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/api/scan/image/${encodeURIComponent(request.id)}`} alt="Uploaded trip document" className="size-16 shrink-0 rounded-md border border-border object-cover" />
                    ) : (
                      <div className="flex size-16 shrink-0 items-center justify-center rounded-md border border-border bg-muted"><Upload className="size-5 text-muted-foreground" aria-hidden /></div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium">{request.documentType === "receipt" ? "Terminal receipt" : "Trip card"}</p>
                        <Badge variant={request.status === "completed" ? "secondary" : "outline"}>{copy.label}</Badge>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">{copy.detail}</p>
                      {request.requestedTripDate && <p className="mt-1 text-xs">Requested date: {formatDateDDMMYYYY(request.requestedTripDate)}</p>}
                      {request.requestNotes && <p className="mt-1 truncate text-xs italic text-muted-foreground">“{request.requestNotes}”</p>}
                      <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                        {request.status === "completed" ? <CheckCircle2 className="size-3" aria-hidden /> : <Clock3 className="size-3" aria-hidden />}
                        Sent {new Date(request.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                      </p>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
