"use client"

import { useState, useTransition } from "react"
import { CalendarClock, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { requestDateChange, requestDelete, withdrawRequest } from "@/app/actions/driver-trips"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { formatDateDDMMYYYY, formatINR } from "@/lib/domain"

interface PendingRequest {
  id: number
  kind: string
  requestedDate: string | null
  createdAt: Date
}
export interface DriverTrip {
  id: number
  tripDate: string
  containerNo: string
  fromLocation: string
  toLocation: string
  company: string
  direction: string
  rate: number
  pendingRequest: PendingRequest | null
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong"
}

/**
 * A driver's trip list. Everything here is either read-only or a request.
 *
 * Note what is missing: no rate field, no edit form, no delete button. A driver
 * asks; the owner decides. The buttons say "Ask to..." for that reason — a
 * button labelled "Delete" that quietly files a request would be worse than no
 * button at all.
 */
export function DriverTripsClient({ trips }: { trips: DriverTrip[] }) {
  const [openTripId, setOpenTripId] = useState<number | null>(null)
  const [mode, setMode] = useState<"date" | "delete" | null>(null)
  const [newDate, setNewDate] = useState("")
  const [reason, setReason] = useState("")
  const [pending, startTransition] = useTransition()

  function openForm(tripId: number, next: "date" | "delete", currentDate: string) {
    setOpenTripId(tripId)
    setMode(next)
    setNewDate(currentDate)
    setReason("")
  }
  function closeForm() {
    setOpenTripId(null)
    setMode(null)
    setReason("")
  }

  function submit(tripId: number) {
    startTransition(async () => {
      try {
        if (mode === "date") {
          await requestDateChange(tripId, newDate, reason)
          toast.success("Sent to the owner. They will accept or refuse it.")
        } else {
          await requestDelete(tripId, reason)
          toast.success("Sent to the owner. The trip stays until they answer.")
        }
        closeForm()
      } catch (error) {
        toast.error(errorMessage(error))
      }
    })
  }

  function withdraw(requestId: number) {
    startTransition(async () => {
      try {
        await withdrawRequest(requestId)
        toast.success("Request taken back")
      } catch (error) {
        toast.error(errorMessage(error))
      }
    })
  }

  if (trips.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          No trips yet. Tap Upload to send a trip card or receipt to the owner.
        </CardContent>
      </Card>
    )
  }

  return (
    <ul className="flex flex-col gap-3">
      {trips.map((trip) => {
        const isOpen = openTripId === trip.id
        return (
          <li key={trip.id}>
            <Card>
              <CardContent className="flex flex-col gap-3 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-sm font-medium">{trip.containerNo}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {formatDateDDMMYYYY(trip.tripDate)} · {trip.fromLocation} → {trip.toLocation}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge variant="secondary">
                      {trip.company} {trip.direction === "EXPORT" ? "EXP" : "IMP"}
                    </Badge>
                    <span className="font-mono text-sm">{formatINR(trip.rate)}</span>
                  </div>
                </div>

                {trip.pendingRequest ? (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted px-3 py-2">
                    <p className="text-xs text-muted-foreground">
                      {trip.pendingRequest.kind === "date_change"
                        ? `Waiting for the owner to move this to ${formatDateDDMMYYYY(trip.pendingRequest.requestedDate ?? "")}`
                        : "Waiting for the owner to remove this trip"}
                    </p>
                    <Button size="xs" variant="ghost" disabled={pending} onClick={() => withdraw(trip.pendingRequest!.id)}>
                      Take back
                    </Button>
                  </div>
                ) : isOpen ? (
                  <div className="flex flex-col gap-3 rounded-md border border-border p-3">
                    {mode === "date" ? (
                      <div className="flex flex-col gap-2">
                        <Label htmlFor={`date-${trip.id}`}>New date</Label>
                        <Input
                          id={`date-${trip.id}`}
                          type="date"
                          value={newDate}
                          onChange={(event) => setNewDate(event.target.value)}
                        />
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Ask the owner to remove this trip. It stays on the books until they agree.
                      </p>
                    )}
                    <div className="flex flex-col gap-2">
                      <Label htmlFor={`reason-${trip.id}`}>Why? (optional)</Label>
                      <Textarea
                        id={`reason-${trip.id}`}
                        rows={2}
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                        placeholder={mode === "date" ? "Card was written a day late" : "Entered twice by mistake"}
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" disabled={pending} onClick={() => submit(trip.id)}>
                        {pending ? "Sending..." : "Send to owner"}
                      </Button>
                      <Button size="sm" variant="ghost" disabled={pending} onClick={closeForm}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => openForm(trip.id, "date", trip.tripDate)}>
                      <CalendarClock className="size-4" aria-hidden="true" />
                      Ask to change date
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => openForm(trip.id, "delete", trip.tripDate)}>
                      <Trash2 className="size-4" aria-hidden="true" />
                      Ask to remove
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </li>
        )
      })}
    </ul>
  )
}
