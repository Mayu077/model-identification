import { completeOwnerSetup } from "@/app/actions/onboarding"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { requireTenant } from "@/lib/tenant"
import { redirect } from "next/navigation"

export default async function SetupPage() {
  const tenant = await requireTenant()
  if (tenant.onboardingCompleted) redirect("/")
  return <main className="flex min-h-svh items-center justify-center bg-background px-4 py-8"><Card className="w-full max-w-lg p-6">
    <h1 className="text-2xl font-semibold text-balance">Configure your business</h1><p className="mt-2 text-sm text-muted-foreground">These details and rates are private to your organization and can be changed later.</p>
    <form action={completeOwnerSetup} className="mt-6 grid gap-4 sm:grid-cols-2">
      <div className="flex flex-col gap-2 sm:col-span-2"><Label htmlFor="businessName">Business name</Label><Input id="businessName" name="businessName" defaultValue={tenant.organizationName} required /></div>
      <div className="flex flex-col gap-2"><Label htmlFor="businessEmail">Business email</Label><Input id="businessEmail" name="businessEmail" type="email" defaultValue={tenant.user.email} required /></div>
      <div className="flex flex-col gap-2"><Label htmlFor="businessMobile">Mobile</Label><Input id="businessMobile" name="businessMobile" required /></div>
      <div className="flex flex-col gap-2"><Label htmlFor="gstPercent">GST percent</Label><Input id="gstPercent" name="gstPercent" type="number" defaultValue="18" min="0" max="100" required /></div>
      <div className="flex flex-col gap-2"><Label htmlFor="defaultRate">Initial default trip rate</Label><Input id="defaultRate" name="defaultRate" type="number" defaultValue="3000" min="1" required /></div>
      <Button type="submit" className="sm:col-span-2">Finish setup</Button>
    </form>
  </Card></main>
}
