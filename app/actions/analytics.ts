"use server"

import { db } from "@/lib/db"
import { expenses, trips } from "@/lib/db/schema"
import { sql } from "drizzle-orm"
import { generateBusinessInsights } from "@/lib/ai/extract"

export interface MonthlyStat {
  month: string // YYYY-MM
  income: number
  expense: number
}

export interface AnalyticsData {
  monthly: MonthlyStat[]
  expenseByCategory: Array<{ category: string; amount: number }>
  tripsByCategory: Array<{ category: string; count: number; amount: number }>
  totals: { income: number; expense: number; tripCount: number }
}

export async function getAnalytics(): Promise<AnalyticsData> {
  const [incomeRows, expenseRows, expCat, tripCat, totals] = await Promise.all([
    db
      .select({
        month: sql<string>`to_char(${trips.tripDate}, 'YYYY-MM')`,
        income: sql<number>`coalesce(sum(${trips.rate}), 0)::int`,
      })
      .from(trips)
      .groupBy(sql`to_char(${trips.tripDate}, 'YYYY-MM')`),
    db
      .select({
        month: sql<string>`to_char(${expenses.expenseDate}, 'YYYY-MM')`,
        expense: sql<number>`coalesce(sum(${expenses.amount}), 0)::int`,
      })
      .from(expenses)
      .groupBy(sql`to_char(${expenses.expenseDate}, 'YYYY-MM')`),
    db
      .select({
        category: expenses.category,
        amount: sql<number>`coalesce(sum(${expenses.amount}), 0)::int`,
      })
      .from(expenses)
      .groupBy(expenses.category),
    db
      .select({
        category: sql<string>`${trips.company} || ' ' || ${trips.direction}`,
        count: sql<number>`count(*)::int`,
        amount: sql<number>`coalesce(sum(${trips.rate}), 0)::int`,
      })
      .from(trips)
      .groupBy(trips.company, trips.direction),
    Promise.all([
      db.select({ v: sql<number>`coalesce(sum(${trips.rate}), 0)::int`, c: sql<number>`count(*)::int` }).from(trips),
      db.select({ v: sql<number>`coalesce(sum(${expenses.amount}), 0)::int` }).from(expenses),
    ]),
  ])

  const months = new Map<string, MonthlyStat>()
  for (const r of incomeRows) {
    months.set(r.month, { month: r.month, income: r.income, expense: 0 })
  }
  for (const r of expenseRows) {
    const existing = months.get(r.month)
    if (existing) existing.expense = r.expense
    else months.set(r.month, { month: r.month, income: 0, expense: r.expense })
  }

  return {
    monthly: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)),
    expenseByCategory: expCat.sort((a, b) => b.amount - a.amount),
    tripsByCategory: tripCat.sort((a, b) => b.amount - a.amount),
    totals: {
      income: totals[0][0]?.v ?? 0,
      tripCount: totals[0][0]?.c ?? 0,
      expense: totals[1][0]?.v ?? 0,
    },
  }
}

export async function getAiInsights(): Promise<string> {
  const data = await getAnalytics()
  const context = `TOTALS: income ₹${data.totals.income}, expenses ₹${data.totals.expense}, net ₹${data.totals.income - data.totals.expense}, total trips ${data.totals.tripCount}.

MONTHLY (month: income / expense):
${data.monthly.map((m) => `${m.month}: ₹${m.income} / ₹${m.expense}`).join("\n")}

EXPENSES BY CATEGORY:
${data.expenseByCategory.map((e) => `${e.category}: ₹${e.amount}`).join("\n")}

TRIPS BY CATEGORY (count, revenue):
${data.tripsByCategory.map((t) => `${t.category}: ${t.count} trips, ₹${t.amount}`).join("\n")}`

  return generateBusinessInsights(context)
}
