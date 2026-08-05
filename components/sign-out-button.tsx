"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { authClient } from "@/lib/auth-client"
import { Button } from "@/components/ui/button"

export function SignOutButton({ redirectTo = "/sign-in", className }: { redirectTo?: string; className?: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  return (
    <Button
      variant="outline"
      className={className}
      disabled={loading}
      onClick={async () => {
        setLoading(true)
        await authClient.signOut()
        router.push(redirectTo)
        router.refresh()
      }}
    >
      {loading ? "Signing out..." : "Sign out"}
    </Button>
  )
}
