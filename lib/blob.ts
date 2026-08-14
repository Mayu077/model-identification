import { del, get, put } from "@vercel/blob"

/**
 * Trip-card image storage.
 *
 * The store is created with `--access private`, so a blob URL on its own is not
 * enough to read the file — every read goes through the read-write token held by
 * the server. That is deliberate: a trip card carries container numbers, dates
 * and route information for a real business, so the bytes must never be
 * reachable by anyone who happens to learn the URL. Reads are served by
 * app/api/scan/image/[jobId]/route.ts, which checks org membership first.
 *
 * We persist the *pathname* rather than the URL. `get()` accepts either, the
 * pathname is stable across store migrations, and it keeps the DB free of
 * host names that would go stale if the store were ever moved.
 */

const ACCESS = "private" as const

/** Blobs are keyed by org and scan job, so purging by either is a prefix scan. */
export function tripCardPath(organizationId: string, scanJobId: string): string {
  return `trip-cards/${organizationId}/${scanJobId}.jpg`
}

export async function putTripCard(
  organizationId: string,
  scanJobId: string,
  body: Buffer,
  contentType: string,
): Promise<string> {
  const pathname = tripCardPath(organizationId, scanJobId)
  const { pathname: stored } = await put(pathname, body, {
    access: ACCESS,
    contentType,
    // The scan job id is already unique, and a retry of the same job should
    // land on the same object instead of leaking a second copy.
    addRandomSuffix: false,
    allowOverwrite: true,
  })
  return stored
}

/** Returns null when the blob is gone — e.g. already purged by retention. */
export async function getTripCard(pathname: string) {
  return get(pathname, { access: ACCESS })
}

export async function deleteTripCards(pathnames: string[]): Promise<void> {
  if (pathnames.length === 0) return
  await del(pathnames)
}

export function isBlobConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN)
}

// ─── Letterhead image ────────────────────────────────────────────────────────
// Letterheads are stored with public access because @react-pdf/renderer fetches
// the image by URL at render time — it cannot use a server-side token.
// The file contains no sensitive data (it's a branded header image).

export function letterheadPath(organizationId: string, ext: string): string {
  return `letterheads/${organizationId}/letterhead.${ext}`
}

export async function putLetterhead(
  organizationId: string,
  body: Buffer,
  contentType: string,
  ext: string,
): Promise<string> {
  const pathname = letterheadPath(organizationId, ext)
  const result = await put(pathname, body, {
    access: "public",
    contentType,
    addRandomSuffix: false,
    allowOverwrite: true,
  })
  // Public blobs return a stable URL; return it directly so we can store it in settings.
  return result.url
}

export async function deleteLetterhead(url: string): Promise<void> {
  try {
    await del(url)
  } catch {
    // Best-effort: if the blob is already gone, ignore the error.
  }
}
