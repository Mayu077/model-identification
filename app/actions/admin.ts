"use server"

import { createHash, randomBytes, randomUUID } from "node:crypto"
import { db } from "@/lib/db"
import { auditLogs, ownerInvites } from "@/lib/db/schema"
import { isPlatformOwner, requireOwner } from "@/lib/tenant"
import { writeAudit } from "@/lib/audit"
import { and, desc, eq, isNull } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod"

export async function createOwnerInvite(organizationName: string) {
  const tenant = await requireOwner()
  const name = z.string().min(2).max(100).parse(organizationName)
  const code = randomBytes(24).toString("base64url")
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  const [invite] = await db.insert(ownerInvites).values({ id: randomUUID(), organizationName: name, tokenHash: createHash("sha256").update(code).digest("hex"), createdByUserId: tenant.user.id, expiresAt }).returning({ id: ownerInvites.id })
  await writeAudit({ organizationId: tenant.organizationId, actorUserId: tenant.user.id, action: "owner_invite.created", entityType: "owner_invite", entityId: invite.id, metadata: { organizationName: name, expiresAt: expiresAt.toISOString() } })
  revalidatePath("/admin")
  return { code, expiresAt: expiresAt.toISOString() }
}
export async function revokeOwnerInvite(id: string) {
  const tenant = await requireOwner()
  await db.update(ownerInvites).set({ revokedAt: new Date() }).where(and(eq(ownerInvites.id, id), eq(ownerInvites.createdByUserId, tenant.user.id), isNull(ownerInvites.consumedAt)))
  await writeAudit({ organizationId: tenant.organizationId, actorUserId: tenant.user.id, action: "owner_invite.revoked", entityType: "owner_invite", entityId: id })
  revalidatePath("/admin")
}
export async function getOwnerAdminData() {
  const tenant = await requireOwner()
  const [invites, logs] = await Promise.all([
    db.select({ id: ownerInvites.id, organizationName: ownerInvites.organizationName, expiresAt: ownerInvites.expiresAt, consumedAt: ownerInvites.consumedAt, revokedAt: ownerInvites.revokedAt, createdAt: ownerInvites.createdAt }).from(ownerInvites).where(eq(ownerInvites.createdByUserId, tenant.user.id)).orderBy(desc(ownerInvites.createdAt)).limit(50),
    db.select().from(auditLogs).where(eq(auditLogs.organizationId, tenant.organizationId)).orderBy(desc(auditLogs.createdAt)).limit(100),
  ])
  // Drives the training-export card. The route enforces this too — this only
  // decides whether the button is worth rendering.
  return { invites, logs, platformOwner: isPlatformOwner(tenant.user.email) }
}
