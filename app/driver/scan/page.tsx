import { ScanClient } from "@/components/scan/scan-client"
import { requireDriver } from "@/lib/tenant"

export const metadata = { title: "Scan trip card" }

/**
 * The same scanner the owner uses. Nothing about it needs to differ: saveTrips
 * stamps the driver id from the session, so a card scanned here lands on this
 * driver's list and nowhere else.
 */
export default async function DriverScanPage() {
  await requireDriver()
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 pb-24 md:pb-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-foreground text-balance">Scan trip card</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Photograph the card, check each row against the photo, then send it in.
        </p>
      </header>
      <ScanClient />
    </main>
  )
}
