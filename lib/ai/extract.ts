import { generateText, Output } from "ai"
import {
  extractedExpenseSchema,
  extractedTripSchema,
  sanitizeExtractedTrip,
  type ExtractedExpense,
  type ExtractedTrip,
} from "@/lib/domain"
import { withModelRotation } from "./router"
import { z } from "zod"

const TRIP_EXTRACTION_PROMPT = `You are reading trip documents from an Indian container truck business. The image is ONE of these two document types — identify which first:

DOCUMENT TYPE A — HANDWRITTEN TRIP CARD: a printed grid (columns Date, Container No., Size, Type, From, To, Diesel, Slip No., Pump, Remark) filled in by hand, one trip per row. A full card commonly holds 25-45 rows. Extract EVERY visible trip row — never stop early, never summarise, never say "and so on". Do NOT invent rows that are not on the card. If a value is unreadable, make your best guess from context but never fabricate a whole entry.

CONTINUATION LINES ON A HANDWRITTEN CARD (important): some lines hold ONLY a container number and a size, with no date and no From/To, often marked with an arrow or hook (-> or the like). Such a line is NOT its own trip — it is the SECOND 20ft container of the trip on the line directly above it. Merge it into that row: set that row's tripType to "double" and put this container number in containerNo2. Never emit a trip whose From/To or date is blank.

DOCUMENT TYPE B — COMPUTER-PRINTED TERMINAL RECEIPT(S): printed tickets/EIR slips from port terminals. One image may contain MULTIPLE receipts — extract one trip per receipt.

DETERMINING THE PORT — PRIORITY ORDER (higher rule wins):
1. EXPLICIT DESTINATION/DELIVERY TEXT on the form body, e.g. "CONTAINER DELIVERY TO JNPT" means the port is JNPT — regardless of whose letterhead the form is on. PSA Mumbai operates BMCT but also issues forms (EFORM 13 etc.) for containers delivered to OTHER terminals like JNPT, so never assume PSA Mumbai = BMCT when a delivery-to/destination terminal is printed.
2. Terminal name in the receipt heading/letterhead:
- "GATEWAY TERMINALS INDIA" -> GTI
- "DP World Nhava Sheva" / "Nhava Sheva ICT" -> NSICT
- "Nhava Sheva India Gateway Terminal" -> NSIGT
- "PSA Mumbai" / "BMCT" / "Bharat Mumbai Container Terminal" -> BMCT (only when no other destination terminal is printed on the form)
- "JNPCT" / "Jawaharlal Nehru" -> JNPT
- "JNBaxe" / "JN Baxe" -> JNB
Reading a receipt:
- Container number is labelled "Cntr No", "Container", or "Container NO".
- ISO Code gives the size: codes starting with "2" (22G1, 2210) = 20ft; starting with "4" (4510, 45G1) or marked 40' = 40ft.
- Direction: "Pick-Up Ticket-Import", "Deliver Import Container", or Category "IMPORT" = IMPORT (from the terminal TO JWC/JWR). "Drop-Off Ticket-Export" or "Received Export Container" = EXPORT (FROM JWC/JWR to the terminal).
- Company: "Group Code: JWC" or Destination/To-From "CFSJWC"/"JWC CFS" = JWC. "JWR LOG" truck company or JWR mentions = JWR.
- Date is printed on the receipt (e.g. "01-07-2026", "02/Jul/2026", "03/07/26").
- Each receipt is a SINGLE container trip (tripType "single") unless two 20ft receipts clearly belong to one double trip.

IMAGE QUALITY: if the image is too blurry, overexposed, or unreadable to extract reliably, return an empty trips array rather than guessing entire entries.

Rules:
- Container numbers are 4 letters followed by 7 digits (e.g. DFSU7533469). Fix obvious OCR confusions (O vs 0, I vs 1, S vs 5, T vs E, T vs I) so the result matches this pattern.
- Do NOT compute or verify the ISO 6346 check digit. The application re-checks every container number in code the moment you finish and flags mismatches for human review, so doing that arithmetic yourself is wasted work — on a 40-row card it is slow enough to time the request out. Simply transcribe each container number character by character from the image, correcting only clear handwriting confusions (O vs 0, I vs 1, S vs 5, T vs E, T vs I, 1 vs 7, 4 vs 9). Never invent characters that are not plausibly in the image.
- Sizes are "40" or "20". A double trip means TWO 20ft containers carried together (two container numbers on one row) — set tripType "double" and put the second container number in containerNo2. Otherwise tripType is "single".
- Location shorthand used by the driver (normalize to the canonical name):
  CT -> NSICT, GT -> NSIGT, JNBaxe -> JNB. Known locations: JWC, JWR, NSICT, NSIGT, GTI, JNPT, BMCT, JNB.
- company: "JWC" if the trip starts or ends at JWC, "JWR" if it starts or ends at JWR.
- direction: if the trip goes FROM JWC/JWR TO a port terminal (NSICT, NSIGT, GTI, JNPT, BMCT, JNB) it is "EXPORT". If it comes FROM a port terminal TO JWC/JWR it is "IMPORT".
- Dates: the card may show only day/month (e.g. "17/5" or "17-5-26"). Output full ISO dates (YYYY-MM-DD). Current year is ${new Date().getFullYear()} — use it when the year is missing unless context clearly says otherwise.
- Output dates, sizes and locations EXACTLY in the required format. Never output anything not in the schema.`

export interface TripExtractionResult {
  trips: Array<ExtractedTrip & { warnings: string[] }>
  /** Rows the model returned that failed strict validation and were dropped. */
  droppedRows: number
}

// What the MODEL is asked to produce. Deliberately looser than
// extractedTripSchema: the enums stay (they steer generation and keep the
// vocabulary correct) but the min/max string limits are gone. Output.object
// validates during generation, so a single malformed row under the strict
// schema would throw away all 40 good rows on the card — and a zod error is
// not retryable, so the router would give up without even rotating.
const modelTripSchema = z.object({
  tripDate: z.string(),
  containerNo: z.string(),
  size: z.enum(["40", "20"]),
  tripType: z.enum(["single", "double"]),
  containerNo2: z.string().nullable().optional(),
  fromLocation: z.string(),
  toLocation: z.string(),
  company: z.enum(["JWC", "JWR"]),
  direction: z.enum(["EXPORT", "IMPORT"]),
})

const modelResultSchema = z.object({ trips: z.array(modelTripSchema) })

export async function extractTripsFromImage(
  imageBase64DataUrl: string,
): Promise<TripExtractionResult> {
  const result = await withModelRotation("vision", async (model) => {
    const { output } = await generateText({
      model,
      output: Output.object({ schema: modelResultSchema }),
      // A 45-row card is ~4k tokens of JSON, and on Gemini this ceiling also
      // covers thinking tokens. Left at the provider default, a long card gets
      // truncated mid-JSON and fails to parse.
      maxOutputTokens: 16_384,
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

  // Now apply the strict schema per row, so one unusable row costs one row.
  // Then sanitize, which is where the ISO 6346 checksum is actually verified
  // (in code, instantly) and surfaced as a warning for human review.
  const { trips: rawRows } = modelResultSchema.parse(result)
  let droppedRows = 0
  const trips = rawRows.flatMap((row) => {
    const parsed = extractedTripSchema.safeParse(row)
    if (!parsed.success) {
      droppedRows += 1
      console.log(
        "[extract] dropped unusable row:",
        JSON.stringify(row).slice(0, 200),
        parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      )
      return []
    }
    const { trip, warnings } = sanitizeExtractedTrip(parsed.data)
    return [{ ...trip, warnings }]
  })

  return { trips, droppedRows }
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
