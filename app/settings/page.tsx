import { getRates } from "@/app/actions/trips"
import { getSettings } from "@/app/actions/settings"
import { SettingsClient } from "@/components/settings/settings-client"

export const metadata = { title: "Settings" }

export default async function SettingsPage() {
  const [rates, settings] = await Promise.all([getRates(), getSettings()])
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6 pb-24 md:pb-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Trip rates and business details used on the bill.
        </p>
      </header>
      <SettingsClient rates={rates} settings={settings} />
    </main>
  )
}
