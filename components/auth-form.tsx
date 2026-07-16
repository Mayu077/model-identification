"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { authClient } from "@/lib/auth-client"
import { validateRegistration } from "@/app/actions/onboarding"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card } from "@/components/ui/card"

export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [inviteCode, setInviteCode] = useState(searchParams.get("invite") ?? "")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const isSignUp = mode === "sign-up"

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setLoading(true)
    if (isSignUp) {
      const validation = await validateRegistration(email, inviteCode)
      if (!validation.allowed) { setError(validation.message ?? "Registration is invite-only."); setLoading(false); return }
    }
    const result = isSignUp ? await authClient.signUp.email({ email, password, name }) : await authClient.signIn.email({ email, password })
    setLoading(false)
    if (result.error) { setError(result.error.message ?? "Unable to continue"); return }
    router.push(isSignUp ? `/onboarding${inviteCode ? `?invite=${encodeURIComponent(inviteCode)}` : ""}` : "/")
    router.refresh()
  }

  return <main className="flex min-h-svh items-center justify-center bg-background px-4">
    <Card className="w-full max-w-sm p-6">
      <div className="flex flex-col gap-1"><h1 className="text-2xl font-semibold text-balance">{isSignUp ? "Create owner account" : "Welcome back"}</h1><p className="text-sm text-muted-foreground">{isSignUp ? "Registration requires a private invitation." : "Sign in to your transport workspace."}</p></div>
      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
        {isSignUp && <div className="flex flex-col gap-2"><Label htmlFor="name">Owner name</Label><Input id="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required /></div>}
        <div className="flex flex-col gap-2"><Label htmlFor="email">Email</Label><Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required /></div>
        <div className="flex flex-col gap-2"><Label htmlFor="password">Password</Label><Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={isSignUp ? "new-password" : "current-password"} minLength={10} required /></div>
        {isSignUp && <div className="flex flex-col gap-2"><Label htmlFor="invite">Invitation code</Label><Input id="invite" value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} autoComplete="off" placeholder="Not required for the bootstrap owner" /></div>}
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <Button type="submit" disabled={loading}>{loading ? "Please wait..." : isSignUp ? "Create account" : "Sign in"}</Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted-foreground">{isSignUp ? "Already registered? " : "Have an invitation? "}<Link className="font-medium text-foreground underline-offset-4 hover:underline" href={isSignUp ? "/sign-in" : "/sign-up"}>{isSignUp ? "Sign in" : "Create account"}</Link></p>
    </Card>
  </main>
}
