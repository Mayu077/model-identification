// Downloads the trip-card images referenced by a training-export manifest.
//
//   1. Sign in as the platform owner and download the manifest from
//      /api/admin/training-export (the "Export training data" button on /admin).
//   2. BLOB_READ_WRITE_TOKEN="..." node scripts/export-training-images.mjs \
//        fleetos-training-2026-08-05.jsonl ./training-data
//
// Writes ./training-data/images/<scanJobId>.jpg plus a copy of the manifest, so
// the folder is a self-contained dataset. The blob store is private, so the
// token is required — without it the images cannot be read at all.
//
// Re-running is safe: files that already exist are skipped, so an interrupted
// download resumes rather than starting over.

import { createWriteStream } from "node:fs"
import { mkdir, copyFile, readFile, stat } from "node:fs/promises"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import path from "node:path"
import { get } from "@vercel/blob"

const [manifestPath, outDir = "./training-data"] = process.argv.slice(2)

if (!manifestPath) {
  console.error("Usage: node scripts/export-training-images.mjs <manifest.jsonl> [outDir]")
  process.exit(1)
}
if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error("BLOB_READ_WRITE_TOKEN is not set. Copy it from .env.local or `vercel env pull`.")
  process.exit(1)
}

const imagesDir = path.join(outDir, "images")
await mkdir(imagesDir, { recursive: true })

const manifest = await readFile(manifestPath, "utf8")
const lines = manifest.split("\n").filter((line) => line.trim() !== "")

let downloaded = 0
let skipped = 0
let failed = 0
let rows = 0

for (const [index, line] of lines.entries()) {
  let record
  try {
    record = JSON.parse(line)
  } catch {
    console.warn(`line ${index + 1}: not valid JSON, skipping`)
    failed += 1
    continue
  }
  rows += record.confirmed?.length ?? 0
  const blobPath = record.image?.path
  if (!blobPath) {
    skipped += 1
    continue
  }

  const target = path.join(imagesDir, `${record.scanJobId}.jpg`)
  // Already fetched on an earlier run.
  const existing = await stat(target).catch(() => null)
  if (existing && existing.size > 0) {
    skipped += 1
    continue
  }

  try {
    const blob = await get(blobPath, { access: "private" })
    if (!blob || blob.statusCode !== 200) {
      // Expected for anything past its retention window — the manifest row is
      // still useful as a label record, just without the picture.
      console.warn(`${record.scanJobId}: image no longer in the store`)
      failed += 1
      continue
    }
    await pipeline(Readable.fromWeb(blob.stream), createWriteStream(target))
    downloaded += 1
    if (downloaded % 25 === 0) console.log(`  ${downloaded} images...`)
  } catch (error) {
    console.warn(`${record.scanJobId}: ${error instanceof Error ? error.message : error}`)
    failed += 1
  }
}

await copyFile(manifestPath, path.join(outDir, path.basename(manifestPath)))

console.log(`
Dataset written to ${path.resolve(outDir)}
  scans in manifest : ${lines.length}
  confirmed rows    : ${rows}
  images downloaded : ${downloaded}
  already present   : ${skipped}
  unavailable       : ${failed}
`)
