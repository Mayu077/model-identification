"use server"

import { createHash, randomUUID, timingSafeEqual } from "node:crypto"
import { and, eq, gt, isNull, or, sql } from "drizzle-orm"
import { headers } from "next/headers"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { auditLogs, memberships, organizations, ownerInvites, user } from "@/lib/db/schema"

function hashInvite(code: string) {
  const secret = process.env.INVITE_CODE_SECRET
  if (!secret) throw new Error("Invite registration is not configured")
  return createHash("sha256").update(`${secret}:${code.trim()}`).digest("hex")
}

export async function validateInvite(code: string, email: string) {
  const normalizedEmail = email.trim().toLowerCase()
  const legacyEmail = process.env.LEGACY_OWNER_EMAIL?.trim().toLowerCase()
  if (legacyEmail && normalizedEmail === legacyEmail) return { valid: true }
  if (!code.trim()) return { valid: false, error: "A valid owner invitation code is required." }
  const digest = hashInvite(code)
  const [invite] = await db.select({ hash: ownerInvites.codeHash }).from(ownerInvites).where(and(
    eq(ownerInvites.codeHash, digest), isNull(ownerInvites.revokedAt),
    or(isNull(ownerInvites.expiresAt), gt(ownerInvites.expiresAt, new Date())),
    sql`${ownerInvites.useCount} < ${ownerInvites.maxUses}`,
  )).limit(1)
  if (!invite) return { valid: false, error: "This invitation is invalid, expired, or already used." }
  return { valid: timingSafeEqual(Buffer.from(invite.hash), Buffer.from(digest)) }
}

export async function finishOwnerRegistration(code: string) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error("Unauthorized")
  const existing = await db.select({ id: memberships.id }).from(memberships).where(eq(memberships.userId, session.user.id)).limit(1)
  if (existing.length) return { success: true }

  const normalizedEmail = session.user.email.trim().toLowerCase()
  const legacyEmail = process.env.LEGACY_OWNER_EMAIL?.trim().toLowerCase()
  const isLegacy = Boolean(legacyEmail && normalizedEmail === legacyEmail)
  const orgId = isLegacy ? "legacy-rajeshri-enterprises" : randomUUID()
  const name = isLegacy ? "Rajeshri Enterprises" : `${session.user.name}'s Business`
  const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)}-${orgId.slice(0, 8)}`

  await db.transaction(async (tx) => {
    if (!isLegacy) {
      const digest = hashInvite(code)
      const [consumed] = await tx.update(ownerInvites).set({ useCount: sql`${ownerInvites.useCount} + 1` }).where(and(
        eq(ownerInvites.codeHash, digest), isNull(ownerInvites.revokedAt),
        or(isNull(ownerInvites.expiresAt), gt(ownerInvites.expiresAt, new Date())),
        sql`${ownerInvites.useCount} < ${ownerInvites.maxUses}`,
      )).returning({ id: ownerInvites.id })
      if (!consumed) throw new Error("Invitation is no longer available")
    }
    if (!isLegacy) {
      await tx.insert(organizations).values({ id: orgId, name, slug, isLegacy: false, onboardingCompleted: false })
    } else {
      const [legacyOrganization] = await tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, orgId)).limit(1)
      if (!legacyOrganization) throw new Error("Legacy workspace import has not been completed")
    }
    await tx.insert(memberships).values({ id: randomUUID(), organizationId: orgId, userId: session.user.id, role: "owner" })
    await tx.insert(auditLogs).values({ organizationId: orgId, actorUserId: session.user.id, action: "owner.registered", entityType: "organization", entityId: orgId, metadata: { isLegacy } })
  })
  return { success: true }
}

export async function signOutAction() {
  await auth.api.signOut({ headers: await headers() })
}
