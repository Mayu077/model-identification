import { getMyUploadRequests } from "@/app/actions/scan-requests"
import { DriverUploadClient } from "@/components/scan/driver-upload-client"
import { requireDriver } from "@/lib/tenant"

export const metadata = { title: "Upload trip document" }
export const dynamic = "force-dynamic"

export default async function DriverUploadPage() {
  await requireDriver()
  const requests = await getMyUploadRequests()
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-6 pb-24 md:pb-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-foreground text-balance">Upload trip document</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Send a trip card or terminal receipt to the owner. No AI scan runs from your account.
        </p>
      </header>
      <DriverUploadClient requests={requests} />
    </main>
  )
}
