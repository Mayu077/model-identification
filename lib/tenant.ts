import "server-only"
import { and, eq } from "drizzle-orm"
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { memberships, organizations } from "@/lib/db/schema"

export async function getSessionUser() {
  const session = await auth.api.getSession({ headers: await headers() })
  return session?.user ?? null
}

export async function requireTenant(options?: { allowIncomplete?: boolean }) {
  const user = await getSessionUser()
  if (!user) redirect("/sign-in")
  const [membership] = await db.select({ organizationId: memberships.organizationId, role: memberships.role, onboardingCompleted: organizations.onboardingCompleted })
    .from(memberships).innerJoin(organizations, eq(memberships.organizationId, organizations.id))
    .where(and(eq(memberships.userId, user.id), eq(memberships.status, "active"))).limit(1)
  if (!membership) redirect("/onboarding")
  if (!options?.allowIncomplete && !membership.onboardingCompleted) redirect("/onboarding")
  return { user, ...membership }
}

export async function requireOwner(options?: { allowIncomplete?: boolean }) {
  const tenant = await requireTenant(options)
  if (tenant.role !== "owner") throw new Error("Forbidden")
  return tenant
}
