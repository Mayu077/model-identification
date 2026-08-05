/**
 * How long a scanned trip-card image is kept before app/api/cron/purge-images
 * deletes it. The trip row itself is never touched — only the photo goes, so
 * after the window the entry stays fully auditable in numbers, just no longer
 * re-checkable against the original handwriting.
 *
 * Kept short by default on purpose: a trip card carries a real business's
 * routes, dates and container numbers, and holding those images forever is the
 * kind of open-ended retention India's DPDP Act expects a reason for.
 *
 * This module is imported by the settings form, so it must stay free of any
 * database or Node-only import — the DB lookup lives in retention.server.ts.
 */
export const DEFAULT_IMAGE_RETENTION_DAYS = 90
export const IMAGE_RETENTION_SETTING_KEY = "image_retention_days"

/** 0 disables retention (keep forever); anything else is clamped to 1-3650. */
export function parseRetentionDays(raw: string | null | undefined): number {
  if (raw == null || raw.trim() === "") return DEFAULT_IMAGE_RETENTION_DAYS
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_IMAGE_RETENTION_DAYS
  if (parsed === 0) return 0
  return Math.min(3650, Math.max(1, parsed))
}

/** Null when retention is disabled, meaning the purge job will skip the image. */
export function retentionExpiryFrom(days: number, now = new Date()): Date | null {
  if (days === 0) return null
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000)
}
