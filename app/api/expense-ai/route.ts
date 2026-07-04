import {
  extractExpenseFromImage,
  extractExpenseFromText,
} from "@/lib/ai/extract"

export const maxDuration = 60

export async function POST(req: Request) {
  try {
    const formData = await req.formData()
    const file = formData.get("image")
    const text = formData.get("text")

    if (file instanceof File && file.size > 0) {
      if (file.size > 10 * 1024 * 1024) {
        return Response.json({ error: "Image too large (max 10MB)" }, { status: 400 })
      }
      const buffer = Buffer.from(await file.arrayBuffer())
      const dataUrl = `data:${file.type || "image/jpeg"};base64,${buffer.toString("base64")}`
      const expense = await extractExpenseFromImage(
        dataUrl,
        typeof text === "string" && text.trim() ? text.trim() : undefined,
      )
      return Response.json({ expense, source: "ai_image" })
    }

    if (typeof text === "string" && text.trim()) {
      const expense = await extractExpenseFromText(text.trim())
      return Response.json({ expense, source: "ai_text" })
    }

    return Response.json({ error: "Provide a message or an image" }, { status: 400 })
  } catch (err) {
    console.error("[expense-ai] failed:", err)
    return Response.json(
      { error: err instanceof Error ? err.message : "AI extraction failed" },
      { status: 500 },
    )
  }
}
