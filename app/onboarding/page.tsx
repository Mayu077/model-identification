import { redirect } from "next/navigation"
import { completeOnboarding } from "@/app/actions/onboarding"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { COMPANIES, DIRECTIONS, TRIP_KINDS } from "@/lib/domain"
import { requireOwner } from "@/lib/tenant"

const labels = { "40": "40 ft", "20_single": "20 ft single", "20_double": "20 ft double" }

export default async function OnboardingPage() {
  const tenant = await requireOwner({ allowIncomplete: true })
  if (tenant.onboardingCompleted) redirect("/")
  return <main className="mx-auto flex min-h-svh w-full max-w-3xl items-center px-4 py-10">
    <Card className="w-full"><CardHeader><CardTitle className="text-balance text-2xl">Set up your private workspace</CardTitle><CardDescription>Your business details and rates are isolated from every other owner. You can change them later.</CardDescription></CardHeader>
      <CardContent><form action={completeOnboarding} className="flex flex-col gap-6">
        <section className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-2 md:col-span-2"><Label htmlFor="businessName">Business name</Label><Input id="businessName" name="businessName" required maxLength={100} /></div>
          <div className="flex flex-col gap-2 md:col-span-2"><Label htmlFor="address">Business address</Label><Input id="address" name="address" required maxLength={300} /></div>
          <div className="flex flex-col gap-2"><Label htmlFor="phone">Phone</Label><Input id="phone" name="phone" required maxLength={20} /></div>
          <div className="flex flex-col gap-2"><Label htmlFor="taxId">Tax ID (optional)</Label><Input id="taxId" name="taxId" maxLength={40} /></div>
        </section>
        <section className="flex flex-col gap-4"><div><h2 className="font-semibold">Trip rates</h2><p className="text-sm text-muted-foreground">Enter whole rupee amounts for every service.</p></div>
          <div className="grid gap-4 sm:grid-cols-2">{COMPANIES.flatMap((company) => DIRECTIONS.map((direction) => <fieldset key={`${company}-${direction}`} className="flex flex-col gap-3 rounded-lg border border-border p-4"><legend className="px-1 text-sm font-medium">{company} {direction}</legend>{TRIP_KINDS.map((kind) => <div key={kind} className="flex items-center justify-between gap-3"><Label htmlFor={`rate_${company}_${direction}_${kind}`}>{labels[kind]}</Label><Input className="w-32 font-mono" id={`rate_${company}_${direction}_${kind}`} name={`rate_${company}_${direction}_${kind}`} type="number" min="1" max="1000000" required /></div>)}</fieldset>))}</div>
        </section><Button type="submit" size="lg">Finish setup</Button>
      </form></CardContent></Card>
  </main>
}
