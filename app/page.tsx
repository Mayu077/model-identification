import Link from "next/link"
import { Camera, FileSpreadsheet, TrendingDown, TrendingUp, Wallet } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { db } from "@/lib/db"
import { expenses, trips } from "@/lib/db/schema"
import { formatDateDDMMYYYY, formatINR } from "@/lib/domain"
import { between, desc } from "drizzle-orm"

export const dynamic = "force-dynamic"

function monthRange(): { from: string; to: string } {
  const now = new Date()
  const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const to = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`
  return { from, to }
}

export default async function DashboardPage() {
  const { from, to } = monthRange()
  const [monthTrips, monthExpenses, recentTrips] = await Promise.all([
    db.select().from(trips).where(between(trips.tripDate, from, to)),
    db.select().from(expenses).where(between(expenses.expenseDate, from, to)),
    db.select().from(trips).orderBy(desc(trips.tripDate), desc(trips.id)).limit(5),
  ])

  const income = monthTrips.reduce((s, t) => s + t.rate, 0)
  const spent = monthExpenses.reduce((s, e) => s + e.amount, 0)
  const profit = income - spent

  return (
    <main className="flex flex-col gap-6 p-4 md:p-6">
      <header>
        <h1 className="text-2xl font-semibold text-balance">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          This month: {formatDateDDMMYYYY(from)} to {formatDateDDMMYYYY(to)}
        </p>
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
            <p className="text-xs text-muted-foreground">{monthTrips.length} trips</p>
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
              {monthExpenses.length} entries
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
