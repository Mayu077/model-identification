"use server"
import { and, between, desc, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { db } from "@/lib/db"
import { auditLogs, expenses } from "@/lib/db/schema"
import { EXPENSE_CATEGORIES } from "@/lib/domain"
import { requireOwner } from "@/lib/tenant"
const schema = z.object({ expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), category: z.enum(EXPENSE_CATEGORIES), amount: z.number().int().positive().max(10_000_000), description: z.string().max(300).nullable().optional(), source: z.enum(["manual", "ai_text", "ai_image"]).default("manual") })
export async function addExpense(input: z.infer<typeof schema>) { const t = await requireOwner(); const e = schema.parse(input); const [row] = await db.insert(expenses).values({ organizationId: t.organizationId, ...e, description: e.description ?? null }).returning(); await db.insert(auditLogs).values({ organizationId: t.organizationId, actorUserId: t.user.id, action: "expense.created", entityType: "expense", entityId: String(row.id) }); revalidatePath("/expenses"); revalidatePath("/"); return row }
export async function getExpenses(from?: string, to?: string) { const t = await requireOwner(); const filter = from && to ? and(eq(expenses.organizationId, t.organizationId), between(expenses.expenseDate, from, to)) : eq(expenses.organizationId, t.organizationId); return db.select().from(expenses).where(filter).orderBy(desc(expenses.expenseDate), desc(expenses.id)).limit(300) }
export async function updateExpense(id: number, input: z.infer<typeof schema>) { const t = await requireOwner(); const e = schema.parse(input); const [row] = await db.update(expenses).set({ expenseDate: e.expenseDate, category: e.category, amount: e.amount, description: e.description ?? null }).where(and(eq(expenses.id, id), eq(expenses.organizationId, t.organizationId))).returning({ id: expenses.id }); if (!row) throw new Error("Expense not found"); revalidatePath("/expenses"); revalidatePath("/") }
export async function deleteExpense(id: number) { const t = await requireOwner(); const [row] = await db.delete(expenses).where(and(eq(expenses.id, id), eq(expenses.organizationId, t.organizationId))).returning({ id: expenses.id }); if (!row) throw new Error("Expense not found"); await db.insert(auditLogs).values({ organizationId: t.organizationId, actorUserId: t.user.id, action: "expense.deleted", entityType: "expense", entityId: String(id) }); revalidatePath("/expenses"); revalidatePath("/") }
