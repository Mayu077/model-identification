import { generateText, Output } from "ai"
import {
  extractedExpenseSchema,
  extractionResultSchema,
  sanitizeExtractedTrip,
  type ExtractedExpense,
  type ExtractedTrip,
} from "@/lib/domain"
import { withModelRotation } from "./router"
import { z } from "zod"

const TRIP_EXTRACTION_PROMPT = `You are reading a handwritten trip card from an Indian container truck driver.

Each row on the card is one trip with: container number, size, from-location, to-location, and date. Extract EVERY visible trip row. Do NOT invent rows that are not on the card. If a value is unreadable, make your best guess from context but never fabricate a whole entry.

Rules:
- Container numbers are 4 letters followed by 7 digits (e.g. DFSU7533469). Fix obvious OCR confusions (O vs 0, I vs 1, S vs 5, T vs E, T vs I) so the result matches this pattern.
- ISO 6346 CHECK DIGIT VERIFICATION (MANDATORY): the 11th character of every container number is a mathematical check digit. Before outputting a container number, verify it: convert each of the first 10 characters to a value (digits = face value; letters A=10, B=12, C=13 ... skipping multiples of 11, so no letter maps to 11, 22, or 33), multiply each value by 2^position (position 0-9 left to right), sum them, take sum mod 11 mod 10 — the result must equal the 11th digit. If it does not match, re-examine the handwriting for a misread character (e.g. an 'E' that is actually 'T', an 'I' that is actually 'T', '1' vs '7', '4' vs '9') and correct it until the checksum passes. Never invent characters that are not plausibly in the image.
- Sizes are "40" or "20". A double trip means TWO 20ft containers carried together (two container numbers on one row) — set tripType "double" and put the second container number in containerNo2. Otherwise tripType is "single".
- Location shorthand used by the driver (normalize to the canonical name):
  CT -> NSICT, GT -> NSIGT, JNBaxe -> JNB. Known locations: JWC, JWR, NSICT, NSIGT, GTI, JNPT, BMCT, JNB.
- company: "JWC" if the trip starts or ends at JWC, "JWR" if it starts or ends at JWR.
- direction: if the trip goes FROM JWC/JWR TO a port terminal (NSICT, NSIGT, GTI, JNPT, BMCT, JNB) it is "EXPORT". If it comes FROM a port terminal TO JWC/JWR it is "IMPORT".
- Dates: the card may show only day/month (e.g. "17/5" or "17-5-26"). Output full ISO dates (YYYY-MM-DD). Current year is ${new Date().getFullYear()} — use it when the year is missing unless context clearly says otherwise.
- Output dates, sizes and locations EXACTLY in the required format. Never output anything not in the schema.`

export interface TripExtractionResult {
  trips: Array<ExtractedTrip & { warnings: string[] }>
}

export async function extractTripsFromImage(
  imageBase64DataUrl: string,
): Promise<TripExtractionResult> {
  const result = await withModelRotation("vision", async (model) => {
    const { output } = await generateText({
      model,
      output: Output.object({ schema: extractionResultSchema }),
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: TRIP_EXTRACTION_PROMPT },
            { type: "image", image: imageBase64DataUrl },
          ],
        },
      ],
    })
    return output
  })

  // Schema-validate + sanitize every row so hallucinated/bad data never
  // reaches the database.
  const validated = extractionResultSchema.parse(result)
  return {
    trips: validated.trips.map((t) => {
      const { trip, warnings } = sanitizeExtractedTrip(t)
      return { ...trip, warnings }
    }),
  }
}

const expenseResultSchema = z.object({ expense: extractedExpenseSchema })

const EXPENSE_PROMPT_BASE = `You are logging a truck business expense.

Categories (choose exactly one): "Diesel", "Driver Advance", "Driver Salary", "Repair & Maintenance", "Others".
- Fuel/petrol pump payments -> Diesel
- Money given to the driver as advance -> Driver Advance
- Monthly driver pay -> Driver Salary
- Tyre puncture, new tyres, truck repairs, modifications, lights, service -> Repair & Maintenance
- Anything else -> Others

Amount must be a positive whole number in rupees. Today's date is ${new Date().toISOString().slice(0, 10)}; if no date is given use today. Output date as YYYY-MM-DD. Put a short human-readable summary in description (e.g. "Tyre puncture repair", "GPay to Sharma Tyres").`

export async function extractExpenseFromText(
  userText: string,
): Promise<ExtractedExpense> {
  const result = await withModelRotation("text", async (model) => {
    const { output } = await generateText({
      model,
      output: Output.object({ schema: expenseResultSchema }),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `${EXPENSE_PROMPT_BASE}\n\nUser message: "${userText}"`,
            },
          ],
        },
      ],
    })
    return output
  })
  return expenseResultSchema.parse(result).expense
}

export async function extractExpenseFromImage(
  imageBase64DataUrl: string,
  note?: string,
): Promise<ExtractedExpense> {
  const result = await withModelRotation("vision", async (model) => {
    const { output } = await generateText({
      model,
      output: Output.object({ schema: expenseResultSchema }),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `${EXPENSE_PROMPT_BASE}\n\nThis image is a payment screenshot (GooglePay/PhonePe) or a bill/receipt photo. Read the amount, date, and payee from it.${note ? ` Extra note from the owner: "${note}"` : ""}`,
            },
            { type: "image", image: imageBase64DataUrl },
          ],
        },
      ],
    })
    return output
  })
  return expenseResultSchema.parse(result).expense
}

export async function generateBusinessInsights(context: string): Promise<string> {
  return withModelRotation("reasoning", async (model) => {
    const { text } = await generateText({
      model,
      prompt: `You are a business analyst for a small Indian container-truck transport business (one truck). Analyze the following data and give practical, concise insights in simple English: profitability, biggest expense drivers, trip volume trends, and 2-3 actionable suggestions. Use rupee amounts. Keep it under 250 words, formatted as short bullet points.\n\n${context}`,
    })
    return text
  })
}
