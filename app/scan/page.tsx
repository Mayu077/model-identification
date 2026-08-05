import { ScanClient } from "@/components/scan/scan-client"
import { requireOwner } from "@/lib/tenant"

export const metadata = { title: "Scan Trip Card" }

export default async function ScanPage() {
  // Without this the page prerendered as static, so a visitor with no session
  // got the full upload UI and only discovered the problem when the upload came
  // back from an API route that had redirected to the sign-in page.
  // Drivers scan at /driver/scan, which is the same component with a driver's
  // navigation around it.
  await requireOwner()
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 pb-24 md:pb-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-foreground text-balance">Scan Trip Card</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload a photo of the trip card. AI extracts entries for review before saving.
        </p>
      </header>
      <ScanClient />
    </main>
  )
}
