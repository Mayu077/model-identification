import { getDriverUploadRequests } from "@/app/actions/scan-requests"
import { DriverRequestQueue } from "@/components/scan/driver-request-queue"
import { ScanClient } from "@/components/scan/scan-client"
import { requireOwner } from "@/lib/tenant"

export const metadata = { title: "Scan Trip Documents" }
export const dynamic = "force-dynamic"

export default async function ScanPage({ searchParams }: { searchParams: Promise<{ request?: string }> }) {
  await requireOwner()
  const [{ request: selectedId }, requests] = await Promise.all([searchParams, getDriverUploadRequests()])
  const selectedRequest = requests.find((request) => request.id === selectedId) ?? null

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 pb-24 md:pb-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-foreground text-balance">Scan trip documents</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Review driver uploads or upload a document yourself. AI extracts entries for you to check before saving.
        </p>
      </header>
      <div className="flex flex-col gap-6">
        <DriverRequestQueue requests={requests} selectedId={selectedId} />
        <ScanClient request={selectedRequest} />
      </div>
    </main>
  )
}
