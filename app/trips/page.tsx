import { getTrips } from "@/app/actions/trips"
import { TripsClient } from "@/components/trips/trips-client"

export const metadata = { title: "Trips" }

export default async function TripsPage() {
  const trips = await getTrips()
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 pb-24 md:pb-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">Trips</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          All saved trip entries. Tap a row to edit or delete.
        </p>
      </header>
      <TripsClient initialTrips={trips} />
    </main>
  )
}
