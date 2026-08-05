"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { CalendarClock, Trash2 } from "lucide-react"
import {
  createDriver,
  deleteDriver,
  generateDriverPassword,
  resetDriverPassword,
  setDriverActive,
} from "@/app/actions/drivers"
import { decideChangeRequest } from "@/app/actions/driver-trips"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formatDateDDMMYYYY, formatINR } from "@/lib/domain"

export interface DriverRow {
  id: number
  name: string
  mobile: string | null
  username: string | null
  active: boolean
  hasLogin: boolean
  tripCount: number
}
export interface ChangeRequestRow {
  id: number
  kind: string
  requestedDate: string | null
  reason: string
  status: string
  createdAt: Date
  driverName: string | null
  tripId: number
  tripDate: string
  containerNo: string
  fromLocation: string
  toLocation: string
  rate: number
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong"
}

export function DriversClient({ drivers, requests }: { drivers: DriverRow[]; requests: ChangeRequestRow[] }) {
  const [pending, startTransition] = useTransition()
  const [name, setName] = useState("")
  const [mobile, setMobile] = useState("")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  // Shown once, right after creation. The password is hashed the moment it is
  // saved, so this is the only chance the owner has to write it down.
  const [issued, setIssued] = useState<{ username: string; password: string } | null>(null)
  const [resetFor, setResetFor] = useState<number | null>(null)
  const [resetPassword, setResetPassword] = useState("")

  const openRequests = requests.filter((request) => request.status === "pending")
  const settledRequests = requests.filter((request) => request.status !== "pending")

  function suggest(setter: (value: string) => void) {
    startTransition(async () => {
      try {
        setter(await generateDriverPassword())
      } catch (error) {
        toast.error(errorMessage(error))
      }
    })
  }

  function add() {
    startTransition(async () => {
      try {
        await createDriver({ name, mobile, username, password })
        setIssued({ username: username.trim().toLowerCase(), password })
        setName("")
        setMobile("")
        setUsername("")
        setPassword("")
        toast.success("Driver added. Give them the username and password below.")
      } catch (error) {
        toast.error(errorMessage(error))
      }
    })
  }

  function toggle(driver: DriverRow) {
    startTransition(async () => {
      try {
        await setDriverActive(driver.id, !driver.active)
        toast.success(driver.active ? `${driver.name} can no longer sign in` : `${driver.name} can sign in again`)
      } catch (error) {
        toast.error(errorMessage(error))
      }
    })
  }

  function applyReset(driverId: number) {
    startTransition(async () => {
      try {
        await resetDriverPassword(driverId, resetPassword)
        setIssued({ username: drivers.find((d) => d.id === driverId)?.username ?? "", password: resetPassword })
        setResetFor(null)
        setResetPassword("")
        toast.success("Password changed. They have been signed out everywhere.")
      } catch (error) {
        toast.error(errorMessage(error))
      }
    })
  }

  function remove(driver: DriverRow) {
    startTransition(async () => {
      try {
        await deleteDriver(driver.id)
        toast.success(`${driver.name} removed`)
      } catch (error) {
        toast.error(errorMessage(error))
      }
    })
  }

  function decide(requestId: number, decision: "approved" | "rejected") {
    startTransition(async () => {
      try {
        await decideChangeRequest(requestId, decision)
        toast.success(decision === "approved" ? "Applied" : "Refused")
      } catch (error) {
        toast.error(errorMessage(error))
      }
    })
  }

  return (
    <div className="flex flex-col gap-6">
      {openRequests.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Waiting for you ({openRequests.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col divide-y divide-border">
              {openRequests.map((request) => (
                <li key={request.id} className="flex flex-col gap-2 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-sm font-medium">
                        {request.kind === "date_change" ? (
                          <CalendarClock className="size-4 shrink-0" aria-hidden="true" />
                        ) : (
                          <Trash2 className="size-4 shrink-0" aria-hidden="true" />
                        )}
                        <span className="truncate font-mono">{request.containerNo}</span>
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {request.driverName ?? "Removed driver"} asks to{" "}
                        {request.kind === "date_change"
                          ? `move this from ${formatDateDDMMYYYY(request.tripDate)} to ${formatDateDDMMYYYY(request.requestedDate ?? "")}`
                          : "remove this trip"}
                        {" · "}
                        {request.fromLocation} → {request.toLocation} · {formatINR(request.rate)}
                      </p>
                      {request.reason && <p className="mt-1 text-xs italic text-muted-foreground">“{request.reason}”</p>}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" disabled={pending} onClick={() => decide(request.id, "approved")}>
                      {request.kind === "date_change" ? "Change the date" : "Remove the trip"}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => decide(request.id, "rejected")}>
                      Refuse
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Add a driver</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Drivers cannot sign themselves up. You pick the username and password and pass them on.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="driver-name">Name</Label>
              <Input id="driver-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Bhaskar Patil" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="driver-mobile">Mobile (optional)</Label>
              <Input id="driver-mobile" value={mobile} onChange={(event) => setMobile(event.target.value)} inputMode="tel" placeholder="9876543210" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="driver-username">Username</Label>
              <Input
                id="driver-username"
                value={username}
                onChange={(event) => setUsername(event.target.value.toLowerCase())}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="bhaskar"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="driver-password">Password</Label>
              <div className="flex gap-2">
                <Input id="driver-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 10 characters" />
                <Button type="button" variant="outline" disabled={pending} onClick={() => suggest(setPassword)}>
                  Suggest
                </Button>
              </div>
            </div>
          </div>
          <Button
            className="self-start"
            disabled={pending || name.trim().length < 2 || username.trim().length < 3 || password.length < 10}
            onClick={add}
          >
            {pending ? "Adding..." : "Add driver"}
          </Button>
          {issued && (
            <div className="rounded-md border border-border bg-muted p-3">
              <p className="text-xs text-muted-foreground">Give these to the driver now — the password is not stored in a readable form.</p>
              <p className="mt-1 font-mono text-sm">
                username: {issued.username}
                <br />
                password: {issued.password}
              </p>
              <Button size="xs" variant="ghost" className="mt-2" onClick={() => setIssued(null)}>
                Hide
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Drivers</CardTitle>
        </CardHeader>
        <CardContent>
          {drivers.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No drivers yet.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {drivers.map((driver) => (
                <li key={driver.id} className="flex flex-col gap-2 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{driver.name}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {driver.username ? `@${driver.username}` : "no login"}
                        {driver.mobile ? ` · ${driver.mobile}` : ""} · {driver.tripCount} trip
                        {driver.tripCount === 1 ? "" : "s"}
                      </p>
                    </div>
                    <Badge variant={driver.active ? "secondary" : "destructive"}>
                      {driver.active ? "Active" : "Turned off"}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant={driver.active ? "destructive" : "default"} disabled={pending} onClick={() => toggle(driver)}>
                      {driver.active ? "Turn off access" : "Turn access back on"}
                    </Button>
                    {driver.hasLogin && (
                      <Button size="sm" variant="outline" disabled={pending} onClick={() => { setResetFor(driver.id); setResetPassword("") }}>
                        Reset password
                      </Button>
                    )}
                    {driver.tripCount === 0 && (
                      <Button size="sm" variant="ghost" disabled={pending} onClick={() => remove(driver)}>
                        Remove
                      </Button>
                    )}
                  </div>
                  {resetFor === driver.id && (
                    <div className="flex flex-col gap-2 rounded-md border border-border p-3">
                      <Label htmlFor={`reset-${driver.id}`}>New password</Label>
                      <div className="flex gap-2">
                        <Input id={`reset-${driver.id}`} value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} placeholder="At least 10 characters" />
                        <Button type="button" variant="outline" disabled={pending} onClick={() => suggest(setResetPassword)}>
                          Suggest
                        </Button>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" disabled={pending || resetPassword.length < 10} onClick={() => applyReset(driver.id)}>
                          Set it
                        </Button>
                        <Button size="sm" variant="ghost" disabled={pending} onClick={() => setResetFor(null)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {settledRequests.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Answered requests</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col divide-y divide-border">
              {settledRequests.map((request) => (
                <li key={request.id} className="flex items-center justify-between gap-3 py-2">
                  <p className="min-w-0 truncate text-xs text-muted-foreground">
                    <span className="font-mono">{request.containerNo}</span> ·{" "}
                    {request.kind === "date_change" ? "date change" : "removal"} ·{" "}
                    {request.driverName ?? "removed driver"}
                  </p>
                  <Badge variant={request.status === "approved" ? "secondary" : "outline"}>{request.status}</Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
