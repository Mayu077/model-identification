"use server"

import { eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"
import { db } from "@/lib/db"
import { auditLogs, organizations, rates, settings } from "@/lib/db/schema"
import { requireOwner } from "@/lib/tenant"
import { COMPANIES, DIRECTIONS, TRIP_KINDS } from "@/lib/domain"

const schema = z.object({ businessName: z.string().trim().min(2).max(100), address: z.string().trim().min(5).max(300), phone: z.string().trim().min(7).max(20), taxId: z.string().trim().max(40).optional() })

export async function completeOnboarding(formData: FormData) {
  const tenant = await requireOwner({ allowIncomplete: true })
  const input = schema.parse({ businessName: formData.get("businessName"), address: formData.get("address"), phone: formData.get("phone"), taxId: formData.get("taxId") || undefined })
  const rateRows = COMPANIES.flatMap((company) => DIRECTIONS.flatMap((direction) => TRIP_KINDS.map((tripKind) => {
    const rate = Number(formData.get(`rate_${company}_${direction}_${tripKind}`))
    if (!Number.isInteger(rate) || rate <= 0 || rate > 1_000_000) throw new Error("Every trip rate must be a positive whole number")
    return { organizationId: tenant.organizationId, company, direction, tripKind, rate }
  })))
  await db.transaction(async (tx) => {
    const settingRows = [
      { organizationId: tenant.organizationId, key: "business_name", value: input.businessName },
      { organizationId: tenant.organizationId, key: "business_address", value: input.address },
      { organizationId: tenant.organizationId, key: "business_phone", value: input.phone },
      { organizationId: tenant.organizationId, key: "business_tax_id", value: input.taxId ?? "" },
    ]
    for (const row of settingRows) {
      await tx.insert(settings).values(row).onConflictDoUpdate({
        target: [settings.organizationId, settings.key],
        set: { value: row.value },
      })
    }
    await tx.insert(rates).values(rateRows).onConflictDoNothing()
    await tx.update(organizations).set({ name: input.businessName, onboardingCompleted: true, updatedAt: new Date() }).where(eq(organizations.id, tenant.organizationId))
    await tx.insert(auditLogs).values({ organizationId: tenant.organizationId, actorUserId: tenant.user.id, action: "organization.onboarded", entityType: "organization", entityId: tenant.organizationId })
  })
  revalidatePath("/")
  redirect("/")
}
