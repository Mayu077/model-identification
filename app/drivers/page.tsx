import { getDrivers } from "@/app/actions/drivers"
import { getChangeRequests } from "@/app/actions/driver-trips"
import { DriversClient } from "@/components/drivers/drivers-client"

export const metadata = { title: "Drivers" }
export const dynamic = "force-dynamic"

export default async function DriversPage() {
  // Both actions call requireOwner, so a driver who reaches this URL is
  // redirected before any of it renders.
  const [drivers, requests] = await Promise.all([getDrivers(), getChangeRequests()])
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6 pb-24 md:pb-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">Drivers</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Issue logins, turn access on or off, and answer requests to change or remove a trip.
        </p>
      </header>
      <DriversClient drivers={drivers} requests={requests} />
    </main>
  )
}
