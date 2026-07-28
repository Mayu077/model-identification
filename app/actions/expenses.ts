"use server"

import { db } from "@/lib/db"
import { expenses } from "@/lib/db/schema"
import { EXPENSE_CATEGORIES } from "@/lib/domain"
import { and, between, desc, eq } from "drizzle-orm"
import { requireTenant } from "@/lib/tenant"
import { writeAudit } from "@/lib/audit"
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
  const tenant = await requireTenant()
  const e = expenseInputSchema.parse(input)
  const [row] = await db
    .insert(expenses)
    .values({
      organizationId: tenant.organizationId,
      expenseDate: e.expenseDate,
      category: e.category,
      amount: e.amount,
      description: e.description ?? "",
      source: e.source,
    })
    .returning()
  await writeAudit({ organizationId: tenant.organizationId, actorUserId: tenant.user.id, action: "expense.created", entityType: "expense", entityId: String(row.id), metadata: { category: e.category } })
  revalidatePath("/expenses")
  revalidatePath("/")
  return row
}

export async function getExpenses(from?: string, to?: string) {
  const tenant = await requireTenant()
  if (from && to) {
    return db
      .select()
      .from(expenses)
      .where(and(eq(expenses.organizationId, tenant.organizationId), between(expenses.expenseDate, from, to)))
      .orderBy(desc(expenses.expenseDate), desc(expenses.id))
  }
  return db
    .select()
    .from(expenses)
    .where(eq(expenses.organizationId, tenant.organizationId))
    .orderBy(desc(expenses.expenseDate), desc(expenses.id))
    .limit(300)
}

export async function updateExpense(
  id: number,
  input: z.infer<typeof expenseInputSchema>,
) {
  const tenant = await requireTenant()
  const e = expenseInputSchema.parse(input)
  await db
    .update(expenses)
    .set({
      expenseDate: e.expenseDate,
      category: e.category,
      amount: e.amount,
      description: e.description ?? "",
    })
    .where(and(eq(expenses.id, id), eq(expenses.organizationId, tenant.organizationId)))
  revalidatePath("/expenses")
  revalidatePath("/")
}

export async function deleteExpense(id: number) {
  const tenant = await requireTenant()
  await db.delete(expenses).where(and(eq(expenses.id, id), eq(expenses.organizationId, tenant.organizationId)))
  revalidatePath("/expenses")
  revalidatePath("/")
}
