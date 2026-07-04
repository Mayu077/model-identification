import { ScanClient } from "@/components/scan/scan-client"

export const metadata = { title: "Scan Trip Card" }

export default function ScanPage() {
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
