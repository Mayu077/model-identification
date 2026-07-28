import { AuthForm } from "@/components/auth-form"
import { getSessionUser } from "@/lib/tenant"
import { redirect } from "next/navigation"

export default async function SignInPage() {
  if (await getSessionUser()) redirect("/")
  return <AuthForm mode="sign-in" />
}
