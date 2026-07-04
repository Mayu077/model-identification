import { extractTripsFromImage } from "@/lib/ai/extract"
import { findDuplicates } from "@/app/actions/trips"

export const maxDuration = 60

export async function POST(req: Request) {
  try {
    const formData = await req.formData()
    const file = formData.get("image")
    if (!(file instanceof File)) {
      return Response.json({ error: "No image provided" }, { status: 400 })
    }
    if (file.size > 10 * 1024 * 1024) {
      return Response.json({ error: "Image too large (max 10MB)" }, { status: 400 })
    }
    const buffer = Buffer.from(await file.arrayBuffer())
    const dataUrl = `data:${file.type || "image/jpeg"};base64,${buffer.toString("base64")}`

    const { trips } = await extractTripsFromImage(dataUrl)

    const duplicates = await findDuplicates(
      trips.map((t) => ({ tripDate: t.tripDate, containerNo: t.containerNo })),
    )
    const dupSet = new Set(duplicates.map((d) => `${d.tripDate}|${d.containerNo}`))

    return Response.json({
      trips: trips.map((t) => ({
        ...t,
        isDuplicate: dupSet.has(`${t.tripDate}|${t.containerNo}`),
      })),
    })
  } catch (err) {
    console.error("[scan] extraction failed:", err)
    return Response.json(
      { error: err instanceof Error ? err.message : "Extraction failed" },
      { status: 500 },
    )
  }
}
