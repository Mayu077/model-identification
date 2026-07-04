"use server"

import { db } from "@/lib/db"
import { settings } from "@/lib/db/schema"
import { eq, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod"

export async function getSettings(): Promise<Record<string, string>> {
  const rows = await db.select().from(settings)
  return Object.fromEntries(rows.map((r) => [r.key, r.value]))
}

const ALLOWED_KEYS = [
  "business_name",
  "business_tagline",
  "business_address",
  "business_mobile",
  "business_email",
  "gstin",
  "pan",
  "invoice_prefix",
  "invoice_counter",
  "gst_percent",
  "bill_to",
] as const

export async function updateSetting(key: string, value: string) {
  const k = z.enum(ALLOWED_KEYS).parse(key)
  const v = z.string().max(500).parse(value)
  await db
    .insert(settings)
    .values({ key: k, value: v })
    .onConflictDoUpdate({ target: settings.key, set: { value: v } })
  revalidatePath("/settings")
}

/** Atomically claim the next invoice number, e.g. "RST/2026-27/05". */
export async function nextInvoiceNumber(): Promise<string> {
  const [counterRow] = await db
    .update(settings)
    .set({ value: sql`(${settings.value}::int + 1)::text` })
    .where(eq(settings.key, "invoice_counter"))
    .returning({ value: settings.value })
  const n = Number.parseInt(counterRow?.value ?? "1", 10) - 1
  const [prefixRow] = await db
    .select()
    .from(settings)
    .where(eq(settings.key, "invoice_prefix"))
  const prefix = prefixRow?.value ?? "RST/"
  return `${prefix}${String(n).padStart(2, "0")}`
}
