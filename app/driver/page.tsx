import { getMyTrips } from "@/app/actions/driver-trips"
import { DriverTripsClient } from "@/components/driver/driver-trips-client"
import { SignOutButton } from "@/components/sign-out-button"
import { requireDriver } from "@/lib/tenant"

export const metadata = { title: "My trips" }
export const dynamic = "force-dynamic"

export default async function DriverHomePage() {
  const driver = await requireDriver()
  const trips = await getMyTrips()
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-6 pb-24 md:pb-8">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">My trips</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {driver.driverName} · {driver.organizationName}
          </p>
        </div>
        <SignOutButton redirectTo="/driver/sign-in" />
      </header>
      <DriverTripsClient trips={trips} />
    </main>
  )
}
