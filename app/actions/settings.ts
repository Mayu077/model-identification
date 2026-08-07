"use server"

import { db } from "@/lib/db"
import { account, session, settings } from "@/lib/db/schema"
import { writeAudit } from "@/lib/audit"
import { requireOwner } from "@/lib/tenant"
import { auth } from "@/lib/auth"
import { IMAGE_RETENTION_SETTING_KEY, parseRetentionDays } from "@/lib/retention"
import { and, eq, ne, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { headers } from "next/headers"
import { z } from "zod"

export async function getSettings(): Promise<Record<string, string>> {
  const tenant = await requireOwner()
  const rows = await db.select().from(settings).where(eq(settings.organizationId, tenant.organizationId))
  return Object.fromEntries(rows.map((row) => [row.key, row.value]))
}
const ALLOWED_KEYS = [
  "business_name", "business_tagline", "business_address", "business_mobile", "business_email",
  "gstin", "pan", "invoice_prefix", "invoice_counter", "gst_percent",
  "bill_to", "billing_address", "vehicle_number",
  "bank_account_name", "bank_name", "bank_account_no", "bank_ifsc", "bank_branch",
  "authorized_signatory",
  IMAGE_RETENTION_SETTING_KEY,
] as const
export async function updateSetting(key: string, value: string) {
  const tenant = await requireOwner()
  const parsedKey = z.enum(ALLOWED_KEYS).parse(key)
  // Retention drives an irreversible delete, so normalize it here rather than
  // trusting whatever the form posted.
  const parsedValue = parsedKey === IMAGE_RETENTION_SETTING_KEY ? String(parseRetentionDays(value)) : z.string().max(500).parse(value)
  await db.insert(settings).values({ organizationId: tenant.organizationId, key: parsedKey, value: parsedValue }).onConflictDoUpdate({ target: [settings.organizationId, settings.key], set: { value: parsedValue } })
  await writeAudit({ organizationId: tenant.organizationId, actorUserId: tenant.user.id, action: "setting.updated", entityType: "setting", entityId: parsedKey })
  revalidatePath("/settings")
}
export async function nextInvoiceNumber() {
  const tenant = await requireOwner()
  const [counter] = await db.update(settings).set({ value: sql`(${settings.value}::int + 1)::text` }).where(and(eq(settings.organizationId, tenant.organizationId), eq(settings.key, "invoice_counter"))).returning({ value: settings.value })
  const [prefix] = await db.select().from(settings).where(and(eq(settings.organizationId, tenant.organizationId), eq(settings.key, "invoice_prefix"))).limit(1)
  await writeAudit({ organizationId: tenant.organizationId, actorUserId: tenant.user.id, action: "invoice.number_claimed", entityType: "invoice" })
  return `${prefix?.value ?? "INV/"}${String(Number.parseInt(counter?.value ?? "1", 10) - 1).padStart(2, "0")}`
}

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(10, "New password must be at least 10 characters").max(128),
  confirmPassword: z.string(),
}).refine((d) => d.newPassword === d.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
})

/**
 * Let an owner change their own password. Verifies the current password before
 * accepting the new one, and keeps the active session alive so they are not
 * immediately signed out (unlike the driver password reset, which invalidates
 * all sessions because it is triggered after a security event).
 */
export async function changeOwnerPassword(input: {
  currentPassword: string
  newPassword: string
  confirmPassword: string
}) {
  const tenant = await requireOwner()
  const parsed = changePasswordSchema.parse(input)

  // Look up the credential account row for this user.
  const [acc] = await db
    .select({ id: account.id, password: account.password })
    .from(account)
    .where(and(eq(account.userId, tenant.user.id), eq(account.providerId, "credential")))
    .limit(1)
  if (!acc?.password) throw new Error("No password credential found for this account")

  // Verify the current password using Better Auth's own hasher so the check
  // is consistent regardless of which algorithm is in use.
  const ctx = await auth.$context
  const valid = await ctx.password.verify({ hash: acc.password, password: parsed.currentPassword })
  if (!valid) throw new Error("Current password is incorrect")

  const newHash = await ctx.password.hash(parsed.newPassword)
  await db
    .update(account)
    .set({ password: newHash, updatedAt: new Date() })
    .where(eq(account.id, acc.id))

  // Invalidate every *other* session so devices that knew the old password stop
  // working. We keep the current session token alive so this page doesn't
  // immediately redirect to sign-in — that would be confusing after a success.
  const currentSession = await auth.api.getSession({ headers: await headers() })
  if (currentSession?.session?.token) {
    await db
      .delete(session)
      .where(and(eq(session.userId, tenant.user.id), ne(session.token, currentSession.session.token)))
  }

  await writeAudit({
    organizationId: tenant.organizationId,
    actorUserId: tenant.user.id,
    action: "owner.password_changed",
    entityType: "user",
    entityId: tenant.user.id,
  })
}
