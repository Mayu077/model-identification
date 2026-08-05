import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { memberships, organizations } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
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

export async function getTenantContext() {
  const currentUser = await requireUser()
  const [membership] = await db.select({ organizationId: memberships.organizationId, role: memberships.role, organizationName: organizations.name, onboardingCompleted: organizations.onboardingCompleted })
    .from(memberships).innerJoin(organizations, eq(memberships.organizationId, organizations.id)).where(eq(memberships.userId, currentUser.id)).limit(1)
  return membership ? { user: currentUser, ...membership } : null
}

export async function requireTenant() {
  const context = await getTenantContext()
  if (!context) redirect("/onboarding")
  return context
}

export async function requireTenantApi() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error("Unauthorized")
  const [membership] = await db.select().from(memberships).where(eq(memberships.userId, session.user.id)).limit(1)
  if (!membership) throw new Error("Organization setup required")
  return { user: session.user, organizationId: membership.organizationId, role: membership.role }
}
