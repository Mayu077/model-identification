import { redirect } from "next/navigation"
import { DriverSignInForm } from "@/components/driver-sign-in-form"
import { getOptionalTenantContext } from "@/lib/tenant"

export const metadata = { title: "Driver sign in" }

export default async function DriverSignInPage() {
  // Already signed in — send them wherever they belong rather than showing a
  // login form to someone who is holding a valid session.
  const context = await getOptionalTenantContext()
  if (context) redirect(context.role === "driver" ? "/driver" : "/")
  return <DriverSignInForm />
}
