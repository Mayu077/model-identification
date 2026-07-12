import { betterAuth } from "better-auth"
import { pool } from "@/lib/db"

const baseURL = process.env.BETTER_AUTH_URL ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : process.env.V0_RUNTIME_URL)
const trustedOrigins = [process.env.BETTER_AUTH_URL, process.env.V0_RUNTIME_URL, process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`, process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`].filter((url): url is string => Boolean(url))

if (!process.env.BETTER_AUTH_SECRET) throw new Error("BETTER_AUTH_SECRET is required")

export const auth = betterAuth({
  database: pool,
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL,
  trustedOrigins,
  emailAndPassword: { enabled: true },
  advanced: process.env.NODE_ENV === "development" ? { defaultCookieAttributes: { sameSite: "none", secure: true } } : undefined,
})
