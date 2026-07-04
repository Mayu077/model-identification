"use client"

import { useState } from "react"
import type { AnalyticsData } from "@/app/actions/analytics"
import { getAiInsights } from "@/app/actions/analytics"
import { formatINR } from "@/lib/domain"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { toast } from "sonner"
import { Loader2, Sparkles, TrendingDown, TrendingUp, Truck } from "lucide-react"

const PIE_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
]

function monthLabel(m: string): string {
  const [y, mo] = m.split("-")
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  return `${names[Number.parseInt(mo, 10) - 1]} ${y.slice(2)}`
}

export function AnalyticsClient({ data }: { data: AnalyticsData }) {
  const [insights, setInsights] = useState<string | null>(null)
  const [loadingInsights, setLoadingInsights] = useState(false)

  const net = data.totals.income - data.totals.expense

  async function loadInsights() {
    setLoadingInsights(true)
    try {
      const text = await getAiInsights()
      setInsights(text)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to generate insights")
    } finally {
      setLoadingInsights(false)
    }
  }

  const monthlyChart = data.monthly.map((m) => ({
    month: monthLabel(m.month),
    Income: m.income,
    Expense: m.expense,
  }))

  return (
    <div className="flex flex-col gap-4">
      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <TrendingUp className="size-3.5 text-chart-2" aria-hidden />
              Income
            </div>
            <p className="mt-1 text-lg font-semibold">{formatINR(data.totals.income)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <TrendingDown className="size-3.5 text-destructive" aria-hidden />
              Expenses
            </div>
            <p className="mt-1 text-lg font-semibold">{formatINR(data.totals.expense)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {net >= 0 ? (
                <TrendingUp className="size-3.5 text-chart-2" aria-hidden />
              ) : (
                <TrendingDown className="size-3.5 text-destructive" aria-hidden />
              )}
              Net
            </div>
            <p
              className={`mt-1 text-lg font-semibold ${net < 0 ? "text-destructive" : "text-chart-2"}`}
            >
              {formatINR(net)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Truck className="size-3.5 text-primary" aria-hidden />
              Trips
            </div>
            <p className="mt-1 text-lg font-semibold">{data.totals.tripCount}</p>
          </CardContent>
        </Card>
      </div>

      {/* Monthly income vs expense */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Income vs Expenses by month</CardTitle>
        </CardHeader>
        <CardContent>
          {monthlyChart.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No data yet.</p>
          ) : (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyChart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="var(--muted-foreground)" />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    stroke="var(--muted-foreground)"
                    tickFormatter={(v: number) => (v >= 100000 ? `${v / 100000}L` : `${v / 1000}k`)}
                  />
                  <Tooltip
                    formatter={(value) => formatINR(Number(value ?? 0))}
                    contentStyle={{
                      backgroundColor: "var(--card)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      color: "var(--foreground)",
                    }}
                  />
                  <Bar dataKey="Income" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Expense" fill="var(--chart-4)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Expense breakdown */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Expenses by category</CardTitle>
          </CardHeader>
          <CardContent>
            {data.expenseByCategory.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No expenses yet.</p>
            ) : (
              <>
                <div className="h-48 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={data.expenseByCategory}
                        dataKey="amount"
                        nameKey="category"
                        innerRadius={45}
                        outerRadius={75}
                        paddingAngle={2}
                      >
                        {data.expenseByCategory.map((_, i) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value) => formatINR(Number(value ?? 0))}
                        contentStyle={{
                          backgroundColor: "var(--card)",
                          border: "1px solid var(--border)",
                          borderRadius: 8,
                          color: "var(--foreground)",
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {data.expenseByCategory.map((e, i) => (
                    <li key={e.category} className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2">
                        <span
                          className="size-2.5 rounded-full"
                          style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                          aria-hidden
                        />
                        {e.category}
                      </span>
                      <span className="font-medium">{formatINR(e.amount)}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </CardContent>
        </Card>

        {/* Trips by category */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Revenue by trip category</CardTitle>
          </CardHeader>
          <CardContent>
            {data.tripsByCategory.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No trips yet.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {data.tripsByCategory.map((t) => {
                  const pct =
                    data.totals.income > 0 ? Math.round((t.amount / data.totals.income) * 100) : 0
                  return (
                    <li key={t.category} className="flex flex-col gap-1">
                      <div className="flex items-center justify-between text-sm">
                        <span>
                          {t.category}{" "}
                          <span className="text-muted-foreground">({t.count} trips)</span>
                        </span>
                        <span className="font-medium">{formatINR(t.amount)}</span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${pct}%` }}
                          role="progressbar"
                          aria-valuenow={pct}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-label={`${t.category}: ${pct}% of revenue`}
                        />
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* AI insights */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="size-4 text-primary" aria-hidden />
            AI business insights
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {insights ? (
            <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
              {insights}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Generate an AI analysis of your profitability, expense drivers, and trends.
            </p>
          )}
          <Button
            onClick={loadInsights}
            disabled={loadingInsights}
            variant={insights ? "outline" : "default"}
            className="self-start"
          >
            {loadingInsights && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {insights ? "Regenerate" : "Generate Insights"}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
