import { claimOrganization } from "@/app/actions/onboarding"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { getTenantContext, requireUser } from "@/lib/tenant"
import { redirect } from "next/navigation"

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ invite?: string }> }) {
  const currentUser = await requireUser()
  if (await getTenantContext()) redirect("/")
  const { invite = "" } = await searchParams
  const isBootstrap = currentUser.email.toLowerCase() === process.env.BOOTSTRAP_OWNER_EMAIL?.trim().toLowerCase()
  return <main className="flex min-h-svh items-center justify-center bg-background px-4"><Card className="w-full max-w-md p-6">
    <h1 className="text-2xl font-semibold text-balance">Secure your workspace</h1>
    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{isBootstrap ? "Your verified bootstrap email will claim the private Rajeshri Enterprises records." : "Enter the one-time code supplied with your invitation."}</p>
    <form action={async (formData) => { "use server"; await claimOrganization(String(formData.get("invite") ?? "")) }} className="mt-6 flex flex-col gap-4">
      {!isBootstrap && <div className="flex flex-col gap-2"><Label htmlFor="invite">Invitation code</Label><Input id="invite" name="invite" defaultValue={invite} required autoComplete="off" /></div>}
      <Button type="submit">{isBootstrap ? "Claim private workspace" : "Create workspace"}</Button>
    </form>
  </Card></main>
}
