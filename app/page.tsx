import Link from "next/link"
import { Camera, FileSpreadsheet, TrendingDown, TrendingUp, Wallet } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { db } from "@/lib/db"
import { drivers, expenses, scanJobs, settings, trips } from "@/lib/db/schema"
import { formatDateDDMMYYYY, formatINR } from "@/lib/domain"
import { approximateDriverSalary, currentIndiaMonthBounds, DRIVER_PAY_SETTING_KEYS, parseDriverPaySettings } from "@/lib/driver-pay"
import { and, asc, desc, eq, gte, inArray, lt, sql } from "drizzle-orm"
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
  const month = currentIndiaMonthBounds()
  const [tripTotals, expenseTotals, recentTrips, monthlyRows, driverRows, driverPayRows, pendingUploadRows] = await Promise.all([
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
    db
      .select({
        forty: sql<number>`count(*) filter (where ${trips.size} = '40')::int`,
        single20: sql<number>`count(*) filter (where ${trips.size} = '20' and ${trips.tripType} = 'single')::int`,
        double20: sql<number>`count(*) filter (where ${trips.size} = '20' and ${trips.tripType} = 'double')::int`,
        loads: sql<number>`count(*)::int`,
        physicalContainers: sql<number>`coalesce(sum(case when ${trips.size} = '20' and ${trips.tripType} = 'double' then 2 else 1 end), 0)::int`,
        revenue: sql<number>`coalesce(sum(${trips.rate}), 0)::int`,
        unassigned: sql<number>`count(*) filter (where ${trips.driverId} is null)::int`,
      })
      .from(trips)
      .where(and(
        eq(trips.organizationId, tenant.organizationId),
        gte(trips.tripDate, month.startDate),
        lt(trips.tripDate, month.endDate),
      )),
    db
      .select({
        id: drivers.id,
        name: drivers.name,
        active: drivers.active,
        forty: sql<number>`count(${trips.id}) filter (where ${trips.size} = '40')::int`,
        single20: sql<number>`count(${trips.id}) filter (where ${trips.size} = '20' and ${trips.tripType} = 'single')::int`,
        double20: sql<number>`count(${trips.id}) filter (where ${trips.size} = '20' and ${trips.tripType} = 'double')::int`,
        totalTrips: sql<number>`count(${trips.id})::int`,
      })
      .from(drivers)
      .leftJoin(trips, and(
        eq(trips.driverId, drivers.id),
        eq(trips.organizationId, tenant.organizationId),
        gte(trips.tripDate, month.startDate),
        lt(trips.tripDate, month.endDate),
      ))
      .where(eq(drivers.organizationId, tenant.organizationId))
      .groupBy(drivers.id, drivers.name, drivers.active)
      .orderBy(asc(drivers.name)),
    db
      .select({ key: settings.key, value: settings.value })
      .from(settings)
      .where(and(
        eq(settings.organizationId, tenant.organizationId),
        inArray(settings.key, DRIVER_PAY_SETTING_KEYS),
      )),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(scanJobs)
      .where(and(
        eq(scanJobs.organizationId, tenant.organizationId),
        eq(scanJobs.status, "uploaded"),
        gte(scanJobs.createdAt, month.startInstant),
        lt(scanJobs.createdAt, month.endInstant),
      )),
  ])

  const income = tripTotals[0]?.income ?? 0
  const tripCount = tripTotals[0]?.count ?? 0
  const spent = expenseTotals[0]?.spent ?? 0
  const expenseCount = expenseTotals[0]?.count ?? 0
  const profit = income - spent
  const monthly = monthlyRows[0] ?? {
    forty: 0,
    single20: 0,
    double20: 0,
    loads: 0,
    physicalContainers: 0,
    revenue: 0,
    unassigned: 0,
  }
  const pendingUploads = pendingUploadRows[0]?.count ?? 0
  const driverPay = parseDriverPaySettings(Object.fromEntries(driverPayRows.map((row) => [row.key, row.value])))
  const driverSalaries = driverRows
    .filter((driver) => driver.active || driver.totalTrips > 0)
    .map((driver) => ({
      ...driver,
      salary: driverPay ? approximateDriverSalary(driverPay, driver) : null,
    }))

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

      <section className="flex flex-col gap-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">This month</h2>
            <p className="text-sm text-muted-foreground">{month.label} · India calendar month</p>
          </div>
          <Link href="/settings" className="text-sm font-medium text-primary hover:underline">
            Salary settings
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[
            ["40 ft trips", monthly.forty, "trip rows"],
            ["Single 20 ft", monthly.single20, "trip rows"],
            ["Double 20 ft", monthly.double20, "trip rows"],
            ["Total loads", monthly.loads, "all trip rows"],
            ["Physical containers", monthly.physicalContainers, "doubles count as two"],
            ["Monthly revenue", formatINR(monthly.revenue), "customer billing"],
            ["Unassigned trips", monthly.unassigned, "no driver selected"],
            ["Pending driver uploads", pendingUploads, "uploaded this month"],
          ].map(([label, value, detail]) => (
            <Card key={label}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="font-mono text-xl font-semibold">{value}</p>
                <p className="text-xs text-muted-foreground">{detail}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle className="text-base">Approximate driver salary</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  Full monthly base plus this month&apos;s category commissions. Base is not prorated.
                </p>
              </div>
              <Link href="/settings" className="shrink-0 text-sm font-medium text-primary hover:underline">
                Configure
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {!driverPay ? (
              <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                Driver salary settings are incomplete. <Link href="/settings" className="font-medium text-primary hover:underline">Configure all four amounts</Link> to see approximate salaries.
              </p>
            ) : driverSalaries.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">No active drivers or driver trips this month.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {driverSalaries.map((driver) => (
                  <li key={driver.id} className="flex items-center justify-between gap-4 py-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium">{driver.name}</p>
                        {!driver.active && <Badge variant="secondary">Inactive</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {driver.forty} × 40 ft · {driver.single20} × single 20 ft · {driver.double20} × double 20 ft
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-mono text-sm font-semibold">{formatINR(driver.salary ?? 0)}</p>
                      <p className="text-xs text-muted-foreground">approx.</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>

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
