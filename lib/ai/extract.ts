import { generateText, Output } from "ai"
import {
  extractedExpenseSchema,
  extractedTripSchema,
  sanitizeExtractedTrip,
  type ExtractedExpense,
  type ExtractedTrip,
} from "@/lib/domain"
import { RotateToNextModel, withModelRotation } from "./router"
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
- Output dates, sizes and locations EXACTLY in the required format. Never output anything not in the schema.

ROW POSITION (rowTop / rowBottom): every trip MUST carry both rowTop and rowBottom, reporting where on the image you read it, so the owner can be shown that exact strip of the photo to check against. Use a vertical scale of WHOLE NUMBERS where 0 is the very top edge of the image and 1000 is the very bottom edge — e.g. a row a quarter of the way down is around 250, not 0.25. rowTop is the top of that row's band, rowBottom is the bottom. You do NOT need pixel precision and you must NOT do any careful measuring — a rough band that contains the row's handwriting is enough, and a whole-row band is better than a tight one. Requirements: rowTop < rowBottom, and the band should be roughly the height of one row (on a 40-row card each band is about 20-25 units tall; on a card with few rows they are much taller). For a merged continuation line, cover both physical lines in one band. If you genuinely cannot tell where a row sat, set both to null rather than guessing a wrong position — a wrong band is worse than none.`

/**
 * Where on the card a row was read from, as a fraction (0-1) of image height.
 * Only the vertical band is captured: a trip occupies a full-width row of the
 * grid, so the horizontal extent is always "all of it", and asking a vision
 * model for a tight 4-sided box is markedly less reliable than asking for a
 * band. Null whenever the model declined or returned something implausible.
 */
export interface SourceBox {
  top: number
  bottom: number
}

export interface TripExtractionResult {
  trips: Array<ExtractedTrip & { warnings: string[]; sourceBox: SourceBox | null }>
  /** Rows the model returned that failed strict validation and were dropped. */
  droppedRows: number
  /** Rows whose reported position was missing or implausible and was discarded. */
  droppedBoxes: number
  modelUsed?: string
  provider?: string
}

// Model reports 0-1000 over image height. Anything outside these bounds is a
// hallucinated position, and showing the owner the wrong strip of the card
// during a verification step is worse than showing none — so it is discarded
// rather than clamped into something that merely looks plausible.
const MIN_BAND_UNITS = 3 // thinner than this and the crop shows a sliver of ink
const MAX_BAND_UNITS = 400 // taller than 40% of the card is not one row

function toSourceBox(
  rowTop: number | null | undefined,
  rowBottom: number | null | undefined,
): SourceBox | null {
  if (typeof rowTop !== "number" || typeof rowBottom !== "number") return null
  if (!Number.isFinite(rowTop) || !Number.isFinite(rowBottom)) return null
  // The prompt asks for a 0-1000 scale, and the model mostly obeys — but it also
  // answers in plain 0-1 fractions often enough that insisting on one scale threw
  // away every position on a card and hid the crop preview entirely. Both
  // describe the same band, so accept either. A real 0-1000 band can never be
  // this thin (MIN_BAND_UNITS rejects it below), so there is no ambiguity.
  if (rowTop <= 1 && rowBottom <= 1) {
    rowTop *= 1000
    rowBottom *= 1000
  }
  if (rowTop < 0 || rowBottom > 1000 || rowTop >= rowBottom) return null
  const height = rowBottom - rowTop
  if (height < MIN_BAND_UNITS || height > MAX_BAND_UNITS) return null
  // Pad by a fifth of the band so descenders and the row's ruling lines are not
  // shaved off, which is exactly what makes a crop hard to read.
  const pad = height * 0.2
  return {
    top: Math.max(0, rowTop - pad) / 1000,
    bottom: Math.min(1000, rowBottom + pad) / 1000,
  }
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
  // Vertical band this row was read from, 0-1000 over image height. Required
  // keys with nullable values, NOT optional: when these were optional the faster
  // models simply left them out — gemini-3.1-flash-lite omitted rowBottom on
  // every row of a card — and the crop preview silently disappeared for the whole
  // scan. A required key goes into the provider's response schema, so the model
  // has to answer; nullable still lets it say "I could not place this row".
  rowTop: z.number().nullable(),
  rowBottom: z.number().nullable(),
})

const modelResultSchema = z.object({ trips: z.array(modelTripSchema) })

/**
 * Message for the case where every model we could reach read the card and found
 * nothing on it. Deliberately names the likely cause: the photos that fail this
 * way are almost always WhatsApp copies, which are re-compressed to 720p, and at
 * that size a container number is about ten pixels per character.
 */
export const NO_ROWS_MESSAGE =
  "Could not read any trips from this photo. If it reached you over WhatsApp, ask for the original photo instead — WhatsApp shrinks images and the handwriting stops being readable. Otherwise retake it square-on, filling the frame with the card."

export class NoRowsExtracted extends Error {
  constructor() {
    super(NO_ROWS_MESSAGE)
    this.name = "NoRowsExtracted"
  }
}

/**
 * Transcribing a grid is reading, not reasoning, and Gemini's thinking tokens
 * are pure cost here: measured on a real 17-row card, thinking on took 87-99s
 * and thinking off took 10-12s, and both produced the same 17 rows with the same
 * single misread character. The 90s per-attempt ceiling was landing right on top
 * of the thinking-on figure, which is what made large cards fail while single
 * printed receipts came back fine.
 */
const PROVIDER_OPTIONS = {
  google: { thinkingConfig: { thinkingBudget: 0 } },
} as const

export async function extractTripsFromImage(
  imageBase64DataUrl: string,
): Promise<TripExtractionResult> {
  const { output, info } = await withModelRotation("vision", async (model, candidateInfo) => {
    const { output } = await generateText({
      model,
      output: Output.object({ schema: modelResultSchema }),
      // A 45-row card is ~4k tokens of JSON, and on Gemini this ceiling also
      // covers thinking tokens. Left at the provider default, a long card gets
      // truncated mid-JSON and fails to parse.
      maxOutputTokens: 16_384,
      // The router does the retrying. Left at the SDK default of 2, a single
      // busy model would retry itself three times with backoff — measured at
      // 264s on one candidate — so the router's own rotation never got a turn
      // inside the budget and the whole scan failed on one unlucky model.
      maxRetries: 0,
      providerOptions: PROVIDER_OPTIONS,
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
    // An empty array is what the prompt asks for when the image is unreadable,
    // but it is also what a weak fallback model returns from a card it simply
    // could not handle. Treat it as a reason to try a different model: the cost
    // is one fast call, and the alternative is telling the owner their clear
    // photo was unreadable because the third model in the chain gave up.
    if (output.trips.length === 0) throw new RotateToNextModel("model returned no trip rows")
    return { output, info: candidateInfo }
  }).catch((error: unknown) => {
    if (error instanceof RotateToNextModel) throw new NoRowsExtracted()
    throw error
  })

  // Now apply the strict schema per row, so one unusable row costs one row.
  // Then sanitize, which is where the ISO 6346 checksum is actually verified
  // (in code, instantly) and surfaced as a warning for human review.
  const { trips: rawRows } = modelResultSchema.parse(output)
  let droppedRows = 0
  let droppedBoxes = 0
  // Samples of positions we refused, so a card whose crop previews all vanish can
  // be diagnosed from the log instead of by re-running the model by hand.
  const rejectedPositions: string[] = []
  const trips = rawRows.flatMap((row) => {
    // extractedTripSchema strips rowTop/rowBottom (unknown keys), so read the
    // position off the raw row before parsing.
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
    const sourceBox = toSourceBox(row.rowTop, row.rowBottom)
    if (!sourceBox) {
      droppedBoxes += 1
      if (rejectedPositions.length < 3) rejectedPositions.push(`${row.rowTop}..${row.rowBottom}`)
    }
    const { trip, warnings } = sanitizeExtractedTrip(parsed.data)
    return [{ ...trip, warnings, sourceBox }]
  })

  if (droppedBoxes > 0) {
    console.log(`[extract] ${droppedBoxes} of ${rawRows.length} row position(s) unusable, e.g. ${rejectedPositions.join(", ")}`)
  }
  return {
    trips,
    droppedRows,
    droppedBoxes,
    modelUsed: info.modelId,
    provider: info.provider,
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
      // As above: rotation is the router's job, not the SDK's.
      maxRetries: 0,
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
      // As above: rotation is the router's job, not the SDK's.
      maxRetries: 0,
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
