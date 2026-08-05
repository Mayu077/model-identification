import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { drivers, memberships, organizations } from "@/lib/db/schema"
import { and, eq } from "drizzle-orm"
import { headers } from "next/headers"
import { redirect } from "next/navigation"

/**
 * The single bootstrap account that operates the platform itself, as opposed to
 * owning one business on it. Same check as onboarding uses to let this address
 * register without an invite code — it is the only cross-organization identity
 * in the system.
 */
export function isPlatformOwner(email: string | null | undefined): boolean {
  const bootstrap = process.env.BOOTSTRAP_OWNER_EMAIL?.trim().toLowerCase()
  if (!bootstrap || !email) return false
  return email.trim().toLowerCase() === bootstrap
}

export async function getSessionUser() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return null
  return session.user
}

export async function requireUser() {
  const currentUser = await getSessionUser()
  if (!currentUser) redirect("/sign-in")
  return currentUser
}

async function membershipFor(userId: string) {
  const [membership] = await db.select({ organizationId: memberships.organizationId, role: memberships.role, organizationName: organizations.name, onboardingCompleted: organizations.onboardingCompleted })
    .from(memberships).innerJoin(organizations, eq(memberships.organizationId, organizations.id)).where(eq(memberships.userId, userId)).limit(1)
  return membership ?? null
}

export async function getTenantContext() {
  const currentUser = await requireUser()
  const membership = await membershipFor(currentUser.id)
  return membership ? { user: currentUser, ...membership } : null
}

/**
 * Like getTenantContext but never redirects — returns null for a signed-out
 * visitor instead. Sign-in pages need this: they run for people with no session
 * by definition, and the redirecting variant would bounce them to another login
 * form before the page could render.
 */
export async function getOptionalTenantContext() {
  const currentUser = await getSessionUser()
  if (!currentUser) return null
  const membership = await membershipFor(currentUser.id)
  return membership ? { user: currentUser, ...membership } : null
}

export async function requireTenant() {
  const context = await getTenantContext()
  if (!context) redirect("/onboarding")
  return context
}

/**
 * Owner-only screens and actions.
 *
 * A driver who navigates to an owner URL is sent to their own dashboard rather
 * than to sign-in — they are signed in perfectly well, just not entitled, and
 * bouncing them to a login form would look like their password stopped working.
 */
export async function requireOwner() {
  const context = await requireTenant()
  if (context.role !== "owner") redirect("/driver")
  return context
}

/**
 * Which driver, if any, is behind the current request — for the handful of
 * actions both tiers share (saving a scan, most obviously), so the row can be
 * attributed without duplicating the whole action per tier. Owners get null,
 * which is what an unattributed trip means: the owner entered it themselves.
 */
export async function actingDriverId(context: { user: { id: string }; organizationId: string; role: string }): Promise<number | null> {
  if (context.role !== "driver") return null
  const [driver] = await db.select({ id: drivers.id, active: drivers.active }).from(drivers)
    .where(and(eq(drivers.userId, context.user.id), eq(drivers.organizationId, context.organizationId))).limit(1)
  if (!driver || !driver.active) redirect("/driver/no-access")
  return driver.id
}

export interface DriverContext {
  user: Awaited<ReturnType<typeof requireUser>>
  organizationId: string
  organizationName: string
  driverId: number
  driverName: string
}

/**
 * Driver-only screens and actions.
 *
 * The `active` flag is re-read here on every single request, not cached and not
 * checked once at login. Sessions last a week, so an owner who revokes access
 * after finding a problem needs it to take effect on the driver's very next tap
 * — anything less makes the "instant revoke" button a lie. Revoking also drops
 * the driver's sessions, so this is the second of two locks, not the only one.
 */
export async function requireDriver(): Promise<DriverContext> {
  const context = await requireTenant()
  if (context.role !== "driver") redirect("/")
  const [driver] = await db
    .select({ id: drivers.id, name: drivers.name, active: drivers.active })
    .from(drivers)
    .where(and(eq(drivers.userId, context.user.id), eq(drivers.organizationId, context.organizationId)))
    .limit(1)
  if (!driver || !driver.active) redirect("/driver/no-access")
  return {
    user: context.user,
    organizationId: context.organizationId,
    organizationName: context.organizationName,
    driverId: driver.id,
    driverName: driver.name,
  }
}

export async function requireTenantApi() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error("Unauthorized")
  const [membership] = await db.select().from(memberships).where(eq(memberships.userId, session.user.id)).limit(1)
  if (!membership) throw new Error("Organization setup required")
  // Same live revocation check as requireDriver, for the API routes a driver
  // reaches (scan upload, card image). Without it a revoked driver could keep
  // scanning through the API for the remaining life of their session cookie.
  let driverId: number | null = null
  if (membership.role === "driver") {
    const [driver] = await db.select({ id: drivers.id, active: drivers.active }).from(drivers)
      .where(and(eq(drivers.userId, session.user.id), eq(drivers.organizationId, membership.organizationId))).limit(1)
    if (!driver || !driver.active) throw new Error("Your access has been turned off. Ask the owner to restore it.")
    driverId = driver.id
  }
  return { user: session.user, organizationId: membership.organizationId, role: membership.role, driverId }
}
