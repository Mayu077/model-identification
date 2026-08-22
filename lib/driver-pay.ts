import { z } from "zod"

export const DRIVER_PAY_SETTING_KEYS = [
  "driver_salary_base",
  "driver_commission_40",
  "driver_commission_20_single",
  "driver_commission_20_double",
] as const

export type DriverPaySettingKey = (typeof DRIVER_PAY_SETTING_KEYS)[number]

const wholeRupees = z.preprocess(
  (value) => typeof value === "string" && value.trim() !== "" ? Number(value) : value,
  z.number()
    .int("Enter a whole rupee amount")
    .nonnegative("Amount cannot be negative")
    .max(Number.MAX_SAFE_INTEGER, "Amount is too large"),
)

export const driverPaySettingsSchema = z.object({
  driver_salary_base: wholeRupees,
  driver_commission_40: wholeRupees,
  driver_commission_20_single: wholeRupees,
  driver_commission_20_double: wholeRupees,
}).strict()

export type DriverPaySettings = z.infer<typeof driverPaySettingsSchema>
export type DriverPaySettingsInput = Record<DriverPaySettingKey, string | number>

export const RAJESHRI_DRIVER_PAY_DEFAULTS: DriverPaySettings = {
  driver_salary_base: 15_000,
  driver_commission_40: 400,
  driver_commission_20_single: 400,
  driver_commission_20_double: 600,
}

export function parseDriverPaySettings(
  values: Partial<Record<DriverPaySettingKey, string | number | undefined>>,
): DriverPaySettings | null {
  const parsed = driverPaySettingsSchema.safeParse(
    Object.fromEntries(DRIVER_PAY_SETTING_KEYS.map((key) => [key, values[key]])),
  )
  return parsed.success ? parsed.data : null
}

export function approximateDriverSalary(
  settings: DriverPaySettings,
  trips: { forty: number; single20: number; double20: number },
): number {
  return settings.driver_salary_base
    + trips.forty * settings.driver_commission_40
    + trips.single20 * settings.driver_commission_20_single
    + trips.double20 * settings.driver_commission_20_double
}

const INDIA_OFFSET_MS = 5.5 * 60 * 60 * 1000

/** Calendar and timestamp bounds for the month containing `now` in India. */
export function currentIndiaMonthBounds(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now)
  const year = Number(parts.find((part) => part.type === "year")?.value)
  const month = Number(parts.find((part) => part.type === "month")?.value)
  if (!Number.isInteger(year) || !Number.isInteger(month)) {
    throw new Error("Could not determine the current India calendar month")
  }

  const nextYear = month === 12 ? year + 1 : year
  const nextMonth = month === 12 ? 1 : month + 1
  const date = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}-01`
  const instant = (y: number, m: number) => new Date(Date.UTC(y, m - 1, 1) - INDIA_OFFSET_MS)

  return {
    startDate: date(year, month),
    endDate: date(nextYear, nextMonth),
    startInstant: instant(year, month),
    endInstant: instant(nextYear, nextMonth),
    label: new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      month: "long",
      year: "numeric",
    }).format(now),
  }
}
