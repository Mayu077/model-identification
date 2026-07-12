"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { authClient } from "@/lib/auth-client"
import { finishOwnerRegistration, validateInvite } from "@/app/actions/auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const router = useRouter()
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [inviteCode, setInviteCode] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const isSignUp = mode === "sign-up"

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError(null); setLoading(true)
    try {
      if (isSignUp) {
        const invitation = await validateInvite(inviteCode, email)
        if (!invitation.valid) throw new Error(invitation.error ?? "Invalid invitation")
        const result = await authClient.signUp.email({ email, password, name })
        if (result.error) throw new Error(result.error.message ?? "Could not create account")
        await finishOwnerRegistration(inviteCode)
        router.push("/onboarding")
      } else {
        const result = await authClient.signIn.email({ email, password })
        if (result.error) throw new Error(result.error.message ?? "Could not sign in")
        router.push("/")
      }
      router.refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Something went wrong") } finally { setLoading(false) }
  }

  return <main className="flex min-h-svh items-center justify-center bg-background px-4 py-10">
    <Card className="w-full max-w-md">
      <CardHeader><CardTitle className="text-balance text-2xl">{isSignUp ? "Create an owner account" : "Welcome back"}</CardTitle><CardDescription>{isSignUp ? "Registration is available by invitation only." : "Sign in to your private transport workspace."}</CardDescription></CardHeader>
      <CardContent><form onSubmit={submit} className="flex flex-col gap-4">
        {isSignUp && <div className="flex flex-col gap-2"><Label htmlFor="name">Full name</Label><Input id="name" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" /></div>}
        <div className="flex flex-col gap-2"><Label htmlFor="email">Email</Label><Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" /></div>
        <div className="flex flex-col gap-2"><Label htmlFor="password">Password</Label><Input id="password" type="password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete={isSignUp ? "new-password" : "current-password"} /></div>
        {isSignUp && <div className="flex flex-col gap-2"><Label htmlFor="invite">Owner invitation code</Label><Input id="invite" value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} autoComplete="off" /><p className="text-xs text-muted-foreground">The legacy owner&apos;s configured email does not require a code.</p></div>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button disabled={loading} type="submit">{loading ? "Please wait..." : isSignUp ? "Create account" : "Sign in"}</Button>
      </form><p className="mt-6 text-center text-sm text-muted-foreground">{isSignUp ? "Already registered? " : "Have an invitation? "}<Link className="font-medium text-foreground underline-offset-4 hover:underline" href={isSignUp ? "/sign-in" : "/sign-up"}>{isSignUp ? "Sign in" : "Create account"}</Link></p></CardContent>
    </Card>
  </main>
}
