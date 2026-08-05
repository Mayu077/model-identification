import { z } from "zod"

/**
 * Drivers sign in with a username the owner assigns, not an email address.
 *
 * Better Auth is configured for email + password, and swapping it for the
 * username plugin would mean another migration against the auth tables that
 * already hold real owner accounts. Instead a driver username is mapped to an
 * address in a domain that can never exist, so the credential path is unchanged
 * and no mail is ever sent anywhere. RFC 2606 reserves `.invalid` for exactly
 * this: it is guaranteed not to resolve, so a typo can never reach a stranger.
 *
 * The mapping is one-way in practice — the username is also stored on the
 * driver row, and that is what every screen displays. The synthetic address is
 * an implementation detail of the login and should not be shown to anyone.
 */
export const DRIVER_EMAIL_DOMAIN = "drivers.invalid"

// Lowercase, starts and ends alphanumeric, dots/dashes/underscores inside.
// Deliberately narrow: this gets typed on a phone keyboard at a port gate, and
// it becomes part of an email address, so anything that would need escaping is
// not worth allowing.
export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Username must be at least 3 characters")
  .max(32, "Username must be 32 characters or fewer")
  .regex(
    /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/,
    "Use lowercase letters, numbers, dots, dashes and underscores only",
  )

// Better Auth is configured with minPasswordLength: 10, so anything shorter is
// rejected at sign-in time no matter what is stored here.
export const driverPasswordSchema = z
  .string()
  .min(10, "Password must be at least 10 characters")
  .max(128, "Password must be 128 characters or fewer")

export function usernameToEmail(username: string): string {
  return `${username}@${DRIVER_EMAIL_DOMAIN}`
}

export function isDriverEmail(email: string | null | undefined): boolean {
  return Boolean(email?.toLowerCase().endsWith(`@${DRIVER_EMAIL_DOMAIN}`))
}

/**
 * A password the owner can read out over a phone call and the driver can type
 * once. Two common words, a dash and four digits clears the 10-character
 * minimum, avoids the characters people mistype (no l/1/O/0 ambiguity), and is
 * far easier to relay than a random string — which in practice gets written on
 * the inside of the truck door anyway.
 */
const PASSWORD_WORDS = [
  "truck", "port", "gate", "road", "steel", "cargo", "chain", "diesel",
  "wheel", "crane", "docks", "ledger", "signal", "engine", "bridge", "tanker",
]

export function suggestDriverPassword(randomBytes: Uint8Array): string {
  const first = PASSWORD_WORDS[randomBytes[0] % PASSWORD_WORDS.length]
  const second = PASSWORD_WORDS[randomBytes[1] % PASSWORD_WORDS.length]
  const digits = String(((randomBytes[2] << 8) | randomBytes[3]) % 10000).padStart(4, "0")
  return `${first}-${second}-${digits}`
}
