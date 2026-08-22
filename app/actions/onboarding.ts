"use server"

import { createHash, randomUUID } from "node:crypto"
import { db } from "@/lib/db"
import { auditLogs, memberships, organizations, ownerInvites, rates, settings } from "@/lib/db/schema"
import { RAJESHRI_DRIVER_PAY_DEFAULTS } from "@/lib/driver-pay"
import { requireUser } from "@/lib/tenant"
import { and, eq, gt, isNull } from "drizzle-orm"
import { redirect } from "next/navigation"
import { z } from "zod"

const LEGACY_ORGANIZATION_ID = "legacy-rajeshri-enterprises"
const tokenHash = (token: string) => createHash("sha256").update(token.trim()).digest("hex")
const slugify = (value: string) => `${value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)}-${randomUUID().slice(0, 8)}`

export async function validateRegistration(email: string, inviteCode?: string) {
  const normalizedEmail = z.string().email().parse(email).toLowerCase()
  if (normalizedEmail === process.env.BOOTSTRAP_OWNER_EMAIL?.trim().toLowerCase()) return { allowed: true }
  if (!inviteCode) return { allowed: false, message: "A valid owner invitation code is required." }
  const [invite] = await db.select({ id: ownerInvites.id }).from(ownerInvites).where(and(eq(ownerInvites.tokenHash, tokenHash(inviteCode)), isNull(ownerInvites.consumedAt), isNull(ownerInvites.revokedAt), gt(ownerInvites.expiresAt, new Date()))).limit(1)
  return invite ? { allowed: true } : { allowed: false, message: "This invitation code is invalid, expired, or already used." }
}

export async function claimOrganization(inviteCode?: string) {
  const currentUser = await requireUser()
  const existing = await db.select().from(memberships).where(eq(memberships.userId, currentUser.id)).limit(1)
  if (existing.length) redirect("/")
  const isBootstrap = currentUser.email.toLowerCase() === process.env.BOOTSTRAP_OWNER_EMAIL?.trim().toLowerCase()

  if (isBootstrap) {
    await db.transaction(async (tx) => {
      await tx.insert(organizations).values({ id: LEGACY_ORGANIZATION_ID, name: "Rajeshri Enterprises", slug: "rajeshri-enterprises-legacy", onboardingCompleted: true, isLegacy: true }).onConflictDoNothing()
      await tx.insert(memberships).values({ organizationId: LEGACY_ORGANIZATION_ID, userId: currentUser.id, role: "owner" }).onConflictDoNothing()
      for (const [key, value] of Object.entries(RAJESHRI_DRIVER_PAY_DEFAULTS)) {
        await tx.insert(settings).values({ organizationId: LEGACY_ORGANIZATION_ID, key, value: String(value) }).onConflictDoNothing()
      }
      await tx.insert(auditLogs).values({ organizationId: LEGACY_ORGANIZATION_ID, actorUserId: currentUser.id, action: "organization.claimed", entityType: "organization", entityId: LEGACY_ORGANIZATION_ID, metadata: { method: "bootstrap_email" } })
    })
    redirect("/")
  }

  if (!inviteCode) throw new Error("A valid owner invitation code is required")
  const hash = tokenHash(inviteCode)
  await db.transaction(async (tx) => {
    const [invite] = await tx.select().from(ownerInvites).where(and(eq(ownerInvites.tokenHash, hash), isNull(ownerInvites.consumedAt), isNull(ownerInvites.revokedAt), gt(ownerInvites.expiresAt, new Date()))).for("update").limit(1)
    if (!invite) throw new Error("Invitation code is invalid, expired, or already used")
    const organizationId = randomUUID()
    const organizationName = invite.organizationName?.trim() || `${currentUser.name}'s Transport`
    await tx.insert(organizations).values({ id: organizationId, name: organizationName, slug: slugify(organizationName) })
    await tx.insert(memberships).values({ organizationId, userId: currentUser.id, role: "owner" })
    await tx.update(ownerInvites).set({ consumedAt: new Date(), consumedByUserId: currentUser.id }).where(and(eq(ownerInvites.id, invite.id), isNull(ownerInvites.consumedAt)))
    await tx.insert(auditLogs).values({ organizationId, actorUserId: currentUser.id, action: "organization.created", entityType: "organization", entityId: organizationId, metadata: { method: "owner_invite" } })
  })
  redirect("/onboarding/setup")
}

const setupSchema = z.object({ businessName: z.string().min(2).max(100), businessEmail: z.string().email(), businessMobile: z.string().min(7).max(20), gstPercent: z.coerce.number().min(0).max(100), defaultRate: z.coerce.number().int().positive().max(1_000_000) })
export async function completeOwnerSetup(formData: FormData) {
  const currentUser = await requireUser()
  const [membership] = await db.select().from(memberships).where(eq(memberships.userId, currentUser.id)).limit(1)
  if (!membership) redirect("/onboarding")
  const data = setupSchema.parse(Object.fromEntries(formData))
  await db.transaction(async (tx) => {
    for (const [key, value] of Object.entries({ business_name: data.businessName, business_email: data.businessEmail, business_mobile: data.businessMobile, gst_percent: String(data.gstPercent), invoice_prefix: "INV/", invoice_counter: "1" })) {
      await tx.insert(settings).values({ organizationId: membership.organizationId, key, value }).onConflictDoUpdate({ target: [settings.organizationId, settings.key], set: { value } })
    }
    for (const company of ["JWC", "JWR"]) for (const direction of ["EXPORT", "IMPORT"]) for (const tripKind of ["40", "20_single", "20_double"]) {
      await tx.insert(rates).values({ organizationId: membership.organizationId, company, direction, tripKind, rate: data.defaultRate }).onConflictDoNothing()
    }
    await tx.update(organizations).set({ name: data.businessName, onboardingCompleted: true, updatedAt: new Date() }).where(eq(organizations.id, membership.organizationId))
    await tx.insert(auditLogs).values({ organizationId: membership.organizationId, actorUserId: currentUser.id, action: "onboarding.completed", entityType: "organization", entityId: membership.organizationId, metadata: {} })
  })
  redirect("/")
}
