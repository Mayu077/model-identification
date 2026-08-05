import { Card } from "@/components/ui/card"
import { SignOutButton } from "@/components/sign-out-button"

export const metadata = { title: "Access turned off" }

/**
 * Where requireDriver() sends someone whose access has been switched off.
 *
 * It says plainly what happened and who can undo it. The alternative — dumping
 * them back at the login form — reads as "your password is wrong", which sends
 * the driver hunting for a fault that is not theirs.
 */
export default function DriverNoAccessPage() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm p-6 text-center">
        <h1 className="text-xl font-semibold text-balance">Your access is turned off</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your password is fine — the owner has paused this account. Ask them to switch it back on.
        </p>
        <div className="mt-6">
          <SignOutButton />
        </div>
      </Card>
    </main>
  )
}
