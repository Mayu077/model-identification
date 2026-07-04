"use server"

import { db } from "@/lib/db"
import { expenses } from "@/lib/db/schema"
import { EXPENSE_CATEGORIES } from "@/lib/domain"
import { between, desc, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod"

const expenseInputSchema = z.object({
  expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  category: z.enum(EXPENSE_CATEGORIES),
  amount: z.number().int().positive().max(10_000_000),
  description: z.string().max(300).nullable().optional(),
  source: z.enum(["manual", "ai_text", "ai_image"]).default("manual"),
})

export async function addExpense(input: z.infer<typeof expenseInputSchema>) {
  const e = expenseInputSchema.parse(input)
  const [row] = await db
    .insert(expenses)
    .values({
      expenseDate: e.expenseDate,
      category: e.category,
      amount: e.amount,
      description: e.description ?? null,
      source: e.source,
    })
    .returning()
  revalidatePath("/expenses")
  revalidatePath("/")
  return row
}

export async function getExpenses(from?: string, to?: string) {
  if (from && to) {
    return db
      .select()
      .from(expenses)
      .where(between(expenses.expenseDate, from, to))
      .orderBy(desc(expenses.expenseDate), desc(expenses.id))
  }
  return db
    .select()
    .from(expenses)
    .orderBy(desc(expenses.expenseDate), desc(expenses.id))
    .limit(300)
}

export async function updateExpense(
  id: number,
  input: z.infer<typeof expenseInputSchema>,
) {
  const e = expenseInputSchema.parse(input)
  await db
    .update(expenses)
    .set({
      expenseDate: e.expenseDate,
      category: e.category,
      amount: e.amount,
      description: e.description ?? null,
    })
    .where(eq(expenses.id, id))
  revalidatePath("/expenses")
  revalidatePath("/")
}

export async function deleteExpense(id: number) {
  await db.delete(expenses).where(eq(expenses.id, id))
  revalidatePath("/expenses")
  revalidatePath("/")
}
