"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { toast } from "sonner"
import { Loader2, Trash2, Upload } from "lucide-react"

const MAX_BYTES = 4 * 1024 * 1024
const TARGET_WIDTH = 1600

/**
 * Letterhead PDFs can't be embedded directly into the generated bill PDF, so
 * render page 1 to a PNG in the browser (pdfjs is dynamically imported so it
 * only loads when the user actually picks a PDF).
 */
async function pdfFirstPageToPng(file: File): Promise<File> {
  const pdfjs = await import("pdfjs-dist")
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString()

  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
  const page = await pdf.getPage(1)
  const base = page.getViewport({ scale: 1 })
  const viewport = page.getViewport({ scale: Math.max(2, TARGET_WIDTH / base.width) })

  const canvas = document.createElement("canvas")
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Could not render the PDF — your browser blocked canvas drawing")
  await page.render({ canvas, canvasContext: ctx, viewport }).promise

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"))
  if (!blob) throw new Error("Could not convert the PDF page to an image")
  return new File([blob], "letterhead.png", { type: "image/png" })
}

export function LetterheadCard({ currentUrl }: { currentUrl?: string }) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  async function upload(file: File) {
    if (file.size > MAX_BYTES) {
      toast.error("File must be 4 MB or smaller")
      return
    }
    setBusy(true)
    try {
      const payload = file.type === "application/pdf" ? await pdfFirstPageToPng(file) : file
      const body = new FormData()
      body.set("file", payload)
      const res = await fetch("/api/letterhead", { method: "POST", body })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? "Upload failed")
      }
      toast.success("Letterhead saved — it will be used on the next PDF bill")
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed")
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ""
    }
  }

  async function remove() {
    setBusy(true)
    try {
      const res = await fetch("/api/letterhead", { method: "DELETE" })
      if (!res.ok) throw new Error("Could not remove the letterhead")
      toast.success("Letterhead removed — bills will use the typed business details")
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove the letterhead")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Letterhead (PDF bill header)</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground text-pretty">
          Upload your own letterhead and it replaces the typed header at the top of the PDF
          bill. PNG, JPG, WebP or PDF (first page) up to 4&nbsp;MB. Remove it to fall back to
          the business details card above.
        </p>
        {currentUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={currentUrl}
            alt="Current letterhead"
            className="rounded-lg border border-border bg-white p-2"
          />
        )}
        <div className="flex flex-wrap gap-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,application/pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void upload(file)
            }}
          />
          <Button onClick={() => inputRef.current?.click()} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Upload className="size-4" aria-hidden />}
            {currentUrl ? "Replace Letterhead" : "Upload Letterhead"}
          </Button>
          {currentUrl && (
            <Button variant="outline" onClick={remove} disabled={busy}>
              <Trash2 className="size-4" aria-hidden />
              Remove
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
