import { and, eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { settings } from "@/lib/db/schema"
import { DEFAULT_IMAGE_RETENTION_DAYS, IMAGE_RETENTION_SETTING_KEY, parseRetentionDays } from "@/lib/retention"

/** Per-org image retention window in days. Falls back to the default when unset. */
export async function imageRetentionDays(organizationId: string): Promise<number> {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(and(eq(settings.organizationId, organizationId), eq(settings.key, IMAGE_RETENTION_SETTING_KEY)))
    .limit(1)
  return row ? parseRetentionDays(row.value) : DEFAULT_IMAGE_RETENTION_DAYS
}
