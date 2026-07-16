import { db } from "@/lib/db"
import { auditLogs } from "@/lib/db/schema"

const SECRET_KEYS = /password|secret|token|code|rate|amount|income|expense|pan|gstin/i

function redact(metadata: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(metadata).map(([key, value]) => [key, SECRET_KEYS.test(key) ? "[REDACTED]" : value]))
}

export async function writeAudit(input: { organizationId: string; actorUserId?: string | null; action: string; entityType: string; entityId?: string | null; metadata?: Record<string, unknown> }) {
  await db.insert(auditLogs).values({ organizationId: input.organizationId, actorUserId: input.actorUserId ?? null, action: input.action, entityType: input.entityType, entityId: input.entityId ?? null, metadata: redact(input.metadata ?? {}) })
}
