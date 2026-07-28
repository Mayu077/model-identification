import { Suspense } from "react"
import { AuthForm } from "@/components/auth-form"
import { getSessionUser } from "@/lib/tenant"
import { redirect } from "next/navigation"

export default async function SignUpPage() {
  if (await getSessionUser()) redirect("/")
  return <Suspense><AuthForm mode="sign-up" /></Suspense>
}
