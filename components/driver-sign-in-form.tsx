"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { authClient } from "@/lib/auth-client"
import { usernameToEmail } from "@/lib/driver-auth"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

/**
 * Drivers get a username from the owner, never an email address. The username
 * is turned into the address Better Auth was configured for right here, so the
 * driver never sees it — see lib/driver-auth.ts for why the mapping exists.
 *
 * There is deliberately no "create account" link: driver accounts are issued by
 * the owner, and a self-signup path would let anyone who finds this page join
 * the fleet.
 */
export function DriverSignInForm() {
  const router = useRouter()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setLoading(true)
    const result = await authClient.signIn.email({
      email: usernameToEmail(username.trim().toLowerCase()),
      password,
    })
    setLoading(false)
    if (result.error) {
      // Never say which half was wrong — that turns this form into a way to
      // find out which usernames exist.
      setError("That username and password did not match. Check with the owner.")
      return
    }
    router.push("/driver")
    router.refresh()
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm p-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold text-balance">Driver sign in</h1>
          <p className="text-sm text-muted-foreground">Use the username the owner gave you.</p>
        </div>
        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="username">Username</Label>
            <Input
              id="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              inputMode="text"
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <Button type="submit" disabled={loading}>{loading ? "Signing in..." : "Sign in"}</Button>
        </form>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Owner?{" "}
          <Link className="font-medium text-foreground underline-offset-4 hover:underline" href="/sign-in">
            Sign in here
          </Link>
        </p>
      </Card>
    </main>
  )
}
