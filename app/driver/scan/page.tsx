import { redirect } from "next/navigation"
import { requireDriver } from "@/lib/tenant"

export const metadata = { title: "Upload trip document" }

export default async function LegacyDriverScanPage() {
  await requireDriver()
  redirect("/driver/upload")
}
