import Link from "next/link"
import { Camera, FileSpreadsheet, TrendingDown, TrendingUp, Wallet } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { db } from "@/lib/db"
import { expenses, trips } from "@/lib/db/schema"
import { formatDateDDMMYYYY, formatINR } from "@/lib/domain"
import { desc, eq, sql } from "drizzle-orm"
import { requireOwner } from "@/lib/tenant"

export const dynamic = "force-dynamic"

export default async function DashboardPage() {
  // A driver who opens the app lands here first; requireOwner sends them on to
  // their own dashboard rather than showing them the whole fleet's takings.
  const tenant = await requireOwner()
  if (!tenant.onboardingCompleted) {
    const { redirect } = await import("next/navigation")
    redirect("/onboarding/setup")
  }
  const [tripTotals, expenseTotals, recentTrips] = await Promise.all([
    db
      .select({
        income: sql<number>`coalesce(sum(${trips.rate}), 0)::int`,
        count: sql<number>`count(*)::int`,
      })
      .from(trips)
      .where(eq(trips.organizationId, tenant.organizationId)),
    db
      .select({
        spent: sql<number>`coalesce(sum(${expenses.amount}), 0)::int`,
        count: sql<number>`count(*)::int`,
      })
      .from(expenses)
      .where(eq(expenses.organizationId, tenant.organizationId)),
    db.select().from(trips).where(eq(trips.organizationId, tenant.organizationId)).orderBy(desc(trips.tripDate), desc(trips.id)).limit(5),
  ])

  const income = tripTotals[0]?.income ?? 0
  const tripCount = tripTotals[0]?.count ?? 0
  const spent = expenseTotals[0]?.spent ?? 0
  const expenseCount = expenseTotals[0]?.count ?? 0
  const profit = income - spent

  return (
    <main className="flex flex-col gap-6 p-4 md:p-6">
      <header>
        <h1 className="text-2xl font-semibold text-balance">Dashboard</h1>
        <p className="text-sm text-muted-foreground">All-time business overview</p>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <TrendingUp className="size-4 text-success" aria-hidden="true" />
              Trip Income
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-mono text-2xl font-semibold">{formatINR(income)}</p>
            <p className="text-xs text-muted-foreground">{tripCount} trips</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <TrendingDown className="size-4 text-destructive" aria-hidden="true" />
              Expenses
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-mono text-2xl font-semibold">{formatINR(spent)}</p>
            <p className="text-xs text-muted-foreground">
              {expenseCount} entries
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Wallet className="size-4 text-primary" aria-hidden="true" />
              Net Profit
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p
              className={`font-mono text-2xl font-semibold ${profit >= 0 ? "text-success" : "text-destructive"}`}
            >
              {formatINR(profit)}
            </p>
            <p className="text-xs text-muted-foreground">income minus expenses</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Link
          href="/scan"
          className="flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-6 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          <Camera className="size-5" aria-hidden="true" />
          Scan Trip Card
        </Link>
        <Link
          href="/export"
          className="flex items-center justify-center gap-2 rounded-lg bg-secondary px-4 py-6 text-sm font-medium text-secondary-foreground transition-colors hover:bg-accent"
        >
          <FileSpreadsheet className="size-5" aria-hidden="true" />
          Export Bill
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Trips</CardTitle>
        </CardHeader>
        <CardContent>
          {recentTrips.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No trips yet. Scan your first trip card to get started.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {recentTrips.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-2 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-sm">{t.containerNo}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDateDDMMYYYY(t.tripDate)} · {t.fromLocation} →{" "}
                      {t.toLocation}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant="secondary">
                      {t.company} {t.direction === "EXPORT" ? "EXP" : "IMP"}
                    </Badge>
                    <span className="font-mono text-sm">{formatINR(t.rate)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
