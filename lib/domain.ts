import { z } from "zod"

// ---------- Location auto-correction ----------
// Driver shorthand -> canonical location names
export const LOCATION_CORRECTIONS: Record<string, string> = {
  CT: "NSICT",
  GT: "NSIGT",
  NSCT: "NSICT",
  NSGT: "NSIGT",
  JNBAXE: "JNB",
  JNPAXE: "JNB",
  GTI: "GTI",
  JNPT: "JNPT",
  BMCT: "BMCT",
  NSICT: "NSICT",
  NSIGT: "NSIGT",
  JNB: "JNB",
  JWC: "JWC",
  JWR: "JWR",
}

export const KNOWN_LOCATIONS = [
  "JWC",
  "JWR",
  "NSICT",
  "NSIGT",
  "GTI",
  "JNPT",
  "BMCT",
  "JNB",
]

export function correctLocation(raw: string): string {
  const cleaned = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "")
  return LOCATION_CORRECTIONS[cleaned] ?? raw.trim().toUpperCase()
}

// ---------- Categories ----------
export const COMPANIES = ["JWC", "JWR"] as const
export const DIRECTIONS = ["EXPORT", "IMPORT"] as const
export const TRIP_KINDS = ["40", "20_single", "20_double"] as const

export type Company = (typeof COMPANIES)[number]
export type Direction = (typeof DIRECTIONS)[number]
export type TripKind = (typeof TRIP_KINDS)[number]

export function tripKindOf(size: string, tripType: string): TripKind {
  if (size === "40") return "40"
  return tripType === "double" ? "20_double" : "20_single"
}

export function categoryLabel(company: string, direction: string): string {
  return `${company} ${direction}`
}

// Bill "SERVICE" column, e.g. "JWC EXP"
export function serviceLabel(company: string, direction: string): string {
  return `${company} ${direction === "EXPORT" ? "EXP" : "IMP"}`
}

// Bill "SIZE" column: doubles are rendered as 20*20
export function billSize(size: string, tripType: string): string {
  if (size === "20" && tripType === "double") return "20*20"
  return size
}

// ---------- Validation schema (guards against AI hallucination) ----------
// Container numbers follow ISO 6346: 4 letters + 7 digits. Drivers sometimes
// write partial numbers, so we accept 4 letters + 6-7 digits but flag others.
export const CONTAINER_REGEX = /^[A-Z]{4}\d{6,7}$/

export const extractedTripSchema = z.object({
  tripDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  containerNo: z.string().min(4).max(15),
  size: z.enum(["40", "20"]),
  tripType: z.enum(["single", "double"]),
  containerNo2: z.string().nullable().optional(),
  fromLocation: z.string().min(2).max(20),
  toLocation: z.string().min(2).max(20),
  company: z.enum(["JWC", "JWR"]),
  direction: z.enum(["EXPORT", "IMPORT"]),
})

export type ExtractedTrip = z.infer<typeof extractedTripSchema>

export const extractionResultSchema = z.object({
  trips: z.array(extractedTripSchema),
})

// Sanitize + validate a raw AI-extracted row. Returns warnings instead of
// silently accepting bad data.
export function sanitizeExtractedTrip(t: ExtractedTrip): {
  trip: ExtractedTrip
  warnings: string[]
} {
  const warnings: string[] = []
  const containerNo = t.containerNo.toUpperCase().replace(/[^A-Z0-9]/g, "")
  const containerNo2 = t.containerNo2
    ? t.containerNo2.toUpperCase().replace(/[^A-Z0-9]/g, "")
    : null

  if (!CONTAINER_REGEX.test(containerNo)) {
    warnings.push(`Container "${containerNo}" doesn't match the standard format (4 letters + 7 digits)`)
  }
  if (containerNo2 && !CONTAINER_REGEX.test(containerNo2)) {
    warnings.push(`Container "${containerNo2}" doesn't match the standard format`)
  }

  const fromLocation = correctLocation(t.fromLocation)
  const toLocation = correctLocation(t.toLocation)
  if (!KNOWN_LOCATIONS.includes(fromLocation)) {
    warnings.push(`Unknown "from" location: ${fromLocation}`)
  }
  if (!KNOWN_LOCATIONS.includes(toLocation)) {
    warnings.push(`Unknown "to" location: ${toLocation}`)
  }

  const parsed = new Date(t.tripDate + "T00:00:00")
  if (Number.isNaN(parsed.getTime())) {
    warnings.push(`Invalid date: ${t.tripDate}`)
  } else {
    const now = new Date()
    const yearDiff = Math.abs(parsed.getFullYear() - now.getFullYear())
    if (yearDiff > 1) warnings.push(`Date ${t.tripDate} looks wrong (year far from current)`)
  }

  if (t.size === "20" && t.tripType === "double" && !containerNo2) {
    warnings.push("Double 20ft trip but second container number is missing")
  }

  return {
    trip: { ...t, containerNo, containerNo2, fromLocation, toLocation },
    warnings,
  }
}

// ---------- Expenses ----------
export const EXPENSE_CATEGORIES = [
  "Diesel",
  "Driver Advance",
  "Driver Salary",
  "Repair & Maintenance",
  "Others",
] as const

export const extractedExpenseSchema = z.object({
  expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  category: z.enum(EXPENSE_CATEGORIES),
  amount: z.number().int().positive().max(10_000_000),
  description: z.string().max(300).nullable().optional(),
})

export type ExtractedExpense = z.infer<typeof extractedExpenseSchema>

// ---------- Formatting ----------
export function formatINR(n: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n)
}

export function formatNumberIN(n: number): string {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n)
}

// Amount in words, Indian numbering system (lakh / thousand), for the bill.
const ONES = [
  "", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE",
  "TEN", "ELEVEN", "TWELVE", "THIRTEEN", "FOURTEEN", "FIFTEEN", "SIXTEEN",
  "SEVENTEEN", "EIGHTEEN", "NINETEEN",
]
const TENS = [
  "", "", "TWENTY", "THIRTY", "FORTY", "FIFTY", "SIXTY", "SEVENTY", "EIGHTY", "NINETY",
]

function twoDigits(n: number): string {
  if (n < 20) return ONES[n]
  const t = Math.floor(n / 10)
  const o = n % 10
  return o === 0 ? TENS[t] : `${TENS[t]} ${ONES[o]}`
}

function threeDigits(n: number): string {
  const h = Math.floor(n / 100)
  const rest = n % 100
  const parts: string[] = []
  if (h > 0) parts.push(`${ONES[h]} HUNDRED`)
  if (rest > 0) parts.push(twoDigits(rest))
  return parts.join(" ")
}

export function amountInWords(amount: number): string {
  const n = Math.round(amount)
  if (n === 0) return "ZERO RUPEES ONLY."
  const crore = Math.floor(n / 10_000_000)
  const lakh = Math.floor((n % 10_000_000) / 100_000)
  const thousand = Math.floor((n % 100_000) / 1_000)
  const rest = n % 1_000
  const parts: string[] = []
  if (crore > 0) parts.push(`${twoDigits(crore)} CRORE`)
  if (lakh > 0) parts.push(`${twoDigits(lakh)} LAKH`)
  if (thousand > 0) parts.push(`${twoDigits(thousand)} THOUSAND`)
  if (rest > 0) {
    if (parts.length > 0 && rest < 100) parts.push("AND")
    parts.push(threeDigits(rest))
  }
  return `${parts.join(" ")} RUPEES ONLY.`
}

export function formatDateDDMMYYYY(iso: string): string {
  const [y, m, d] = iso.split("-")
  return `${d}-${m}-${y}`
}
