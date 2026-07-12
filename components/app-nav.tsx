"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  BarChart3,
  Camera,
  FileSpreadsheet,
  LayoutDashboard,
  ListOrdered,
  Settings,
  Wallet,
  LogOut,
} from "lucide-react"
import { useRouter } from "next/navigation"
import { authClient } from "@/lib/auth-client"
import { cn } from "@/lib/utils"

const NAV_ITEMS = [
  { href: "/", label: "Home", icon: LayoutDashboard },
  { href: "/scan", label: "Scan", icon: Camera },
  { href: "/trips", label: "Trips", icon: ListOrdered },
  { href: "/export", label: "Export", icon: FileSpreadsheet },
  { href: "/expenses", label: "Expenses", icon: Wallet },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/settings", label: "Settings", icon: Settings },
]

// Mobile: bottom tab bar (first 5 + settings via home). Desktop: left sidebar.
export function AppNav() {
  const pathname = usePathname()
  const router = useRouter()
  async function signOut() {
    await authClient.signOut()
    router.push("/sign-in")
    router.refresh()
  }

  return (
    <>
      {/* Desktop sidebar */}
      <nav
        aria-label="Main navigation"
        className="fixed inset-y-0 left-0 z-40 hidden w-52 flex-col gap-1 border-r border-border bg-sidebar p-4 md:flex"
      >
        <div className="mb-6 flex items-center gap-2 px-2">
          <div className="flex size-8 items-center justify-center rounded-md bg-primary font-mono text-sm font-bold text-primary-foreground">
            RE
          </div>
          <div className="text-sm font-semibold leading-tight">
            Rajeshri
            <span className="block text-xs font-normal text-muted-foreground">
              Transport
            </span>
          </div>
        </div>
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
              pathname === href
                ? "bg-primary text-primary-foreground font-medium"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <Icon className="size-4" aria-hidden="true" />
            {label}
          </Link>
        ))}
        <button onClick={signOut} className="mt-auto flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground">
          <LogOut className="size-4" aria-hidden="true" />
          Sign out
        </button>
      </nav>

      {/* Mobile bottom bar */}
      <nav
        aria-label="Main navigation"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-sidebar/95 backdrop-blur md:hidden"
      >
        <div className="mx-auto grid max-w-lg grid-cols-7">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex flex-col items-center gap-1 py-2 text-[10px]",
                pathname === href
                  ? "text-primary font-medium"
                  : "text-muted-foreground",
              )}
            >
              <Icon className="size-5" aria-hidden="true" />
              {label}
            </Link>
          ))}
        </div>
      </nav>
    </>
  )
}
