import { betterAuth } from "better-auth"
import { pool } from "@/lib/db"

if (!process.env.BETTER_AUTH_SECRET) throw new Error("BETTER_AUTH_SECRET is required")

// VERCEL_PROJECT_PRODUCTION_URL is set on every deployment, not just production
// ones, so preferring it unconditionally pointed baseURL at the production
// domain while the request was being served from a preview host. Pick by
// VERCEL_ENV instead: the stable production domain in production, the
// deployment's own hostname everywhere else.
const vercelBaseUrl =
  process.env.VERCEL_ENV === "production" && process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : undefined

// Any hostname the app is reached on has to be listed here or Better Auth
// answers 403 INVALID_ORIGIN. Each Vercel deployment gets its own generated
// hostname, so a stable alias in front of a preview needs to be declared —
// comma-separated, e.g. "https://fleetos-scan-test.vercel.app".
const extraTrustedOrigins = (process.env.AUTH_TRUSTED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim().replace(/\/$/, ""))
  .filter(Boolean)

export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET,
  database: pool,
  baseURL: process.env.BETTER_AUTH_URL ?? vercelBaseUrl ?? process.env.V0_RUNTIME_URL,
  emailAndPassword: { enabled: true, autoSignIn: true, minPasswordLength: 10 },
  trustedOrigins: [
    ...(process.env.V0_RUNTIME_URL ? [process.env.V0_RUNTIME_URL] : []),
    ...(process.env.VERCEL_URL ? [`https://${process.env.VERCEL_URL}`] : []),
    ...(process.env.VERCEL_PROJECT_PRODUCTION_URL ? [`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`] : []),
    ...extraTrustedOrigins,
  ],
  session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
  ...(process.env.NODE_ENV === "development" ? { advanced: { defaultCookieAttributes: { sameSite: "none" as const, secure: true } } } : {}),
})
