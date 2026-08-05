"use server"

import { randomBytes } from "node:crypto"
import { and, asc, count, eq, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { account, drivers, memberships, session, trips, user } from "@/lib/db/schema"
import { writeAudit } from "@/lib/audit"
import { requireOwner } from "@/lib/tenant"
import { driverPasswordSchema, suggestDriverPassword, usernameSchema, usernameToEmail } from "@/lib/driver-auth"

// Better Auth's own ids are 32-character alphanumerics (confirmed against the
// live tables). Matching that shape keeps rows written here indistinguishable
// from rows it wrote itself, so nothing downstream has to special-case drivers.
function authId(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
  const bytes = randomBytes(32)
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("")
}

function isUniqueViolation(error: unknown): boolean {
  for (let e: unknown = error, depth = 0; e && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
    if (typeof e === "object" && e !== null && (e as { code?: unknown }).code === "23505") return true
  }
  return false
}

export async function getDrivers() {
  const tenant = await requireOwner()
  return db
    .select({
      id: drivers.id,
      name: drivers.name,
      mobile: drivers.mobile,
      username: drivers.username,
      active: drivers.active,
      hasLogin: sql<boolean>`${drivers.userId} is not null`,
      createdAt: drivers.createdAt,
      tripCount: sql<number>`(select count(*)::int from ${trips} where ${trips.driverId} = ${drivers.id})`,
    })
    .from(drivers)
    .where(eq(drivers.organizationId, tenant.organizationId))
    .orderBy(asc(drivers.name))
}

/** A readable password the owner can relay over the phone. */
export async function generateDriverPassword(): Promise<string> {
  await requireOwner()
  return suggestDriverPassword(randomBytes(4))
}

const createDriverSchema = z.object({
  name: z.string().trim().min(2, "Name is too short").max(60),
  mobile: z.string().trim().max(20).optional().or(z.literal("")),
  username: usernameSchema,
  password: driverPasswordSchema,
})

/**
 * Creates a driver: the roster entry, the login account, and the membership
 * that ties them to this organization — no self-signup anywhere in the flow.
 *
 * The password is hashed with Better Auth's own hasher rather than by calling
 * its sign-up endpoint. Sign-up would issue a session, and this runs inside the
 * *owner's* request, so the owner's browser could end up holding the driver's
 * cookie. Writing the same two rows sign-up would have written avoids that
 * entirely, and the driver signs in normally afterwards.
 */
export async function createDriver(input: z.infer<typeof createDriverSchema>) {
  const tenant = await requireOwner()
  const parsed = createDriverSchema.parse(input)
  const email = usernameToEmail(parsed.username)
  const userId = authId()
  const now = new Date()
  const passwordHash = await (await auth.$context).password.hash(parsed.password)

  try {
    await db.transaction(async (tx) => {
      await tx.insert(user).values({
        id: userId,
        name: parsed.name,
        email,
        // There is no mailbox behind a .invalid address and nothing will ever be
        // sent to it, so leaving this false would only strand the account behind
        // a verification step that can never complete.
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      })
      await tx.insert(account).values({
        id: authId(),
        accountId: userId,
        providerId: "credential",
        userId,
        password: passwordHash,
        createdAt: now,
        updatedAt: now,
      })
      await tx.insert(memberships).values({ organizationId: tenant.organizationId, userId, role: "driver" })
      await tx.insert(drivers).values({
        organizationId: tenant.organizationId,
        name: parsed.name,
        mobile: parsed.mobile ? parsed.mobile : null,
        username: parsed.username,
        userId,
      })
    })
  } catch (error) {
    // Usernames are unique across the whole system, not per organization,
    // because the sign-in form asks for a username with no org alongside it.
    if (isUniqueViolation(error)) throw new Error(`The username "${parsed.username}" is already taken. Try another.`)
    throw error
  }

  await writeAudit({
    organizationId: tenant.organizationId,
    actorUserId: tenant.user.id,
    action: "driver.created",
    entityType: "driver",
    entityId: parsed.username,
    metadata: { name: parsed.name },
  })
  revalidatePath("/drivers")
  return { username: parsed.username }
}

/**
 * The revocation toggle. Turning a driver off drops their sessions as well as
 * clearing the flag: the flag alone is re-checked on every request, but killing
 * the cookie too means a phone that is already open stops working at the next
 * navigation instead of showing a stale page.
 */
export async function setDriverActive(driverId: number, active: boolean) {
  const tenant = await requireOwner()
  const [driver] = await db
    .update(drivers)
    .set({ active, updatedAt: new Date() })
    .where(and(eq(drivers.id, driverId), eq(drivers.organizationId, tenant.organizationId)))
    .returning({ userId: drivers.userId, username: drivers.username })
  if (!driver) throw new Error("Driver not found")
  if (!active && driver.userId) await db.delete(session).where(eq(session.userId, driver.userId))

  await writeAudit({
    organizationId: tenant.organizationId,
    actorUserId: tenant.user.id,
    action: active ? "driver.access_restored" : "driver.access_revoked",
    entityType: "driver",
    entityId: String(driverId),
    metadata: { username: driver.username },
  })
  revalidatePath("/drivers")
}

/** For the "I forgot it" phone call. Also signs the driver out everywhere. */
export async function resetDriverPassword(driverId: number, password: string) {
  const tenant = await requireOwner()
  const parsed = driverPasswordSchema.parse(password)
  const [driver] = await db
    .select({ userId: drivers.userId, username: drivers.username })
    .from(drivers)
    .where(and(eq(drivers.id, driverId), eq(drivers.organizationId, tenant.organizationId)))
    .limit(1)
  if (!driver?.userId) throw new Error("This driver does not have a login")

  const passwordHash = await (await auth.$context).password.hash(parsed)
  await db
    .update(account)
    .set({ password: passwordHash, updatedAt: new Date() })
    .where(and(eq(account.userId, driver.userId), eq(account.providerId, "credential")))
  // An old session would otherwise outlive the password it was issued against,
  // which defeats the point of resetting it after a phone goes missing.
  await db.delete(session).where(eq(session.userId, driver.userId))

  await writeAudit({
    organizationId: tenant.organizationId,
    actorUserId: tenant.user.id,
    action: "driver.password_reset",
    entityType: "driver",
    entityId: String(driverId),
    metadata: { username: driver.username },
  })
  revalidatePath("/drivers")
}

/**
 * Removes a driver entirely. Refused once they have trips: those rows are
 * billing history, and the roster entry is the only thing that says whose work
 * it was. Revoking access is the right move for someone who has left.
 */
export async function deleteDriver(driverId: number) {
  const tenant = await requireOwner()
  const [driver] = await db
    .select({ userId: drivers.userId, username: drivers.username })
    .from(drivers)
    .where(and(eq(drivers.id, driverId), eq(drivers.organizationId, tenant.organizationId)))
    .limit(1)
  if (!driver) throw new Error("Driver not found")
  const [{ value: tripCount }] = await db.select({ value: count() }).from(trips).where(eq(trips.driverId, driverId))
  if (tripCount > 0) {
    throw new Error(`${tripCount} trip(s) are recorded against this driver. Turn their access off instead of deleting them.`)
  }

  await db.delete(drivers).where(and(eq(drivers.id, driverId), eq(drivers.organizationId, tenant.organizationId)))
  // Deleting the auth user cascades to their membership, sessions and account.
  if (driver.userId) await db.delete(user).where(eq(user.id, driver.userId))

  await writeAudit({
    organizationId: tenant.organizationId,
    actorUserId: tenant.user.id,
    action: "driver.deleted",
    entityType: "driver",
    entityId: String(driverId),
    metadata: { username: driver.username },
  })
  revalidatePath("/drivers")
}
