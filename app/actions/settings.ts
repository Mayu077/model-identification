"use server"
import { and, eq, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { db } from "@/lib/db"
import { auditLogs, settings } from "@/lib/db/schema"
import { requireOwner } from "@/lib/tenant"
const KEYS = ["business_name", "business_tagline", "business_address", "business_mobile", "business_phone", "business_email", "business_tax_id", "gstin", "pan", "invoice_prefix", "invoice_counter", "gst_percent", "bill_to"] as const
export async function getSettings() { const t = await requireOwner(); const rows = await db.select().from(settings).where(eq(settings.organizationId, t.organizationId)); return Object.fromEntries(rows.map(r => [r.key, r.value])) }
export async function updateSetting(key: string, value: string) { const t = await requireOwner(); const k = z.enum(KEYS).parse(key); const v = z.string().max(500).parse(value); await db.transaction(async tx => { await tx.insert(settings).values({ organizationId: t.organizationId, key: k, value: v }).onConflictDoUpdate({ target: [settings.organizationId, settings.key], set: { value: v } }); await tx.insert(auditLogs).values({ organizationId: t.organizationId, actorUserId: t.user.id, action: "setting.updated", entityType: "setting", entityId: k }) }); revalidatePath("/settings") }
export async function nextInvoiceNumber() { const t = await requireOwner(); const [row] = await db.update(settings).set({ value: sql`(${settings.value}::int + 1)::text` }).where(and(eq(settings.organizationId, t.organizationId), eq(settings.key, "invoice_counter"))).returning({ value: settings.value }); const n = Number.parseInt(row?.value ?? "1", 10) - 1; const [prefix] = await db.select().from(settings).where(and(eq(settings.organizationId, t.organizationId), eq(settings.key, "invoice_prefix"))); return `${prefix?.value ?? "RST/"}${String(n).padStart(2, "0")}` }
