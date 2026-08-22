"use client"

import Link from "next/link"
import { useTransition } from "react"
import { FileImage, Loader2, X } from "lucide-react"
import { toast } from "sonner"
import { rejectDriverUpload, type DriverUploadRequest } from "@/app/actions/scan-requests"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatDateDDMMYYYY } from "@/lib/domain"
import { cn } from "@/lib/utils"

function actionLabel(status: string) {
  if (status === "succeeded") return "Review result"
  if (status === "failed") return "Retry scan"
  if (status === "queued" || status === "processing") return "Continue"
  return "Open & scan"
}

export function DriverRequestQueue({ requests, selectedId }: { requests: DriverUploadRequest[]; selectedId?: string }) {
  const [pending, startTransition] = useTransition()

  function reject(id: string) {
    startTransition(async () => {
      try {
        await rejectDriverUpload(id)
        toast.success("Upload closed")
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not close upload")
      }
    })
  }

  if (requests.length === 0) return null

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Driver uploads waiting for you ({requests.length})</CardTitle></CardHeader>
      <CardContent>
        <ul className="flex flex-col divide-y divide-border">
          {requests.map((request) => (
            <li key={request.id} className={cn("flex flex-col gap-3 py-3", selectedId === request.id && "rounded-md bg-primary/5 px-3")}>
              <div className="flex gap-3">
                {request.hasImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/scan/image/${encodeURIComponent(request.id)}`} alt="Driver upload" className="size-20 shrink-0 rounded-md border border-border object-cover" />
                ) : (
                  <div className="flex size-20 shrink-0 items-center justify-center rounded-md border border-border bg-muted"><FileImage className="size-5 text-muted-foreground" aria-hidden /></div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">{request.driverName ?? "Removed driver"}</p>
                    <Badge variant="outline">{request.documentType === "receipt" ? "Receipt" : "Trip card"}</Badge>
                    {request.status !== "uploaded" && <Badge variant="secondary">{request.status}</Badge>}
                  </div>
                  {request.requestedTripDate && <p className="mt-1 text-xs">Requested date: {formatDateDDMMYYYY(request.requestedTripDate)}</p>}
                  {request.requestNotes && <p className="mt-1 text-xs italic text-muted-foreground">“{request.requestNotes}”</p>}
                  {request.errorMessage && <p className="mt-1 text-xs text-destructive">{request.errorMessage}</p>}
                  <p className="mt-1 text-[11px] text-muted-foreground">Sent {new Date(request.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link className={buttonVariants({ size: "sm" })} href={`/scan?request=${encodeURIComponent(request.id)}`}>{actionLabel(request.status)}</Link>
                {!['queued', 'processing'].includes(request.status) && (
                  <Button size="sm" variant="ghost" disabled={pending} onClick={() => reject(request.id)}>
                    {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <X className="size-4" aria-hidden />}
                    Close request
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
