import { getOwnerAdminData } from "@/app/actions/admin"
import { OwnerAdmin } from "@/components/admin/owner-admin"

export const metadata = { title: "Owner Administration" }
export default async function AdminPage() {
  const data = await getOwnerAdminData()
  return <main className="mx-auto w-full max-w-3xl px-4 py-6 pb-24 md:pb-8"><header className="mb-6"><h1 className="text-xl font-semibold text-balance">Owner administration</h1><p className="mt-1 text-sm text-muted-foreground">Issue one-time registration codes and review security-sensitive activity.</p></header><OwnerAdmin {...data} /></main>
}
