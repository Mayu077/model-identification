"use server"

import { db } from "@/lib/db"
import { settings } from "@/lib/db/schema"
import { writeAudit } from "@/lib/audit"
import { requireTenant } from "@/lib/tenant"
import { and, eq, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod"

export async function getSettings(): Promise<Record<string, string>> {
  const tenant = await requireTenant()
  const rows = await db.select().from(settings).where(eq(settings.organizationId, tenant.organizationId))
  return Object.fromEntries(rows.map((row) => [row.key, row.value]))
}
const ALLOWED_KEYS = ["business_name", "business_tagline", "business_address", "business_mobile", "business_email", "gstin", "pan", "invoice_prefix", "invoice_counter", "gst_percent", "bill_to"] as const
export async function updateSetting(key: string, value: string) {
  const tenant = await requireTenant()
  const parsedKey = z.enum(ALLOWED_KEYS).parse(key)
  const parsedValue = z.string().max(500).parse(value)
  await db.insert(settings).values({ organizationId: tenant.organizationId, key: parsedKey, value: parsedValue }).onConflictDoUpdate({ target: [settings.organizationId, settings.key], set: { value: parsedValue } })
  await writeAudit({ organizationId: tenant.organizationId, actorUserId: tenant.user.id, action: "setting.updated", entityType: "setting", entityId: parsedKey })
  revalidatePath("/settings")
}
export async function nextInvoiceNumber() {
  const tenant = await requireTenant()
  const [counter] = await db.update(settings).set({ value: sql`(${settings.value}::int + 1)::text` }).where(and(eq(settings.organizationId, tenant.organizationId), eq(settings.key, "invoice_counter"))).returning({ value: settings.value })
  const [prefix] = await db.select().from(settings).where(and(eq(settings.organizationId, tenant.organizationId), eq(settings.key, "invoice_prefix"))).limit(1)
  await writeAudit({ organizationId: tenant.organizationId, actorUserId: tenant.user.id, action: "invoice.number_claimed", entityType: "invoice" })
  return `${prefix?.value ?? "INV/"}${String(Number.parseInt(counter?.value ?? "1", 10) - 1).padStart(2, "0")}`
}
