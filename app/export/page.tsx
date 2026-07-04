import { getSettings } from "@/app/actions/settings"
import { ExportClient } from "@/components/export/export-client"

export const metadata = { title: "Export Bills" }

export default async function ExportPage() {
  const settings = await getSettings()
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6 pb-24 md:pb-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">Export</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pick a date range to download the trip Summary and the Bill as Excel files.
        </p>
      </header>
      <ExportClient settings={settings} />
    </main>
  )
}
