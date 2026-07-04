import { getAnalytics } from "@/app/actions/analytics"
import { AnalyticsClient } from "@/components/analytics/analytics-client"

export const metadata = { title: "Analytics" }

export default async function AnalyticsPage() {
  const data = await getAnalytics()
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 pb-24 md:pb-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">Analytics</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Income, expenses, and AI-powered business insights.
        </p>
      </header>
      <AnalyticsClient data={data} />
    </main>
  )
}
