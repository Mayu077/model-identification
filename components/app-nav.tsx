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
  Users,
  Wallet,
} from "lucide-react"
import { cn } from "@/lib/utils"

const OWNER_NAV_ITEMS = [
  { href: "/", label: "Home", icon: LayoutDashboard },
  { href: "/scan", label: "Scan", icon: Camera },
  { href: "/trips", label: "Trips", icon: ListOrdered },
  { href: "/export", label: "Export", icon: FileSpreadsheet },
  { href: "/expenses", label: "Expenses", icon: Wallet },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/drivers", label: "Drivers", icon: Users },
  { href: "/settings", label: "Settings", icon: Settings },
]

// Two tabs, both of them large. A driver is using this one-handed, standing at
// a gate — everything the owner tier has that a driver has no business seeing
// is simply absent here rather than shown and then refused.
const DRIVER_NAV_ITEMS = [
  { href: "/driver", label: "My trips", icon: ListOrdered },
  { href: "/driver/scan", label: "Scan", icon: Camera },
]

// Mobile: bottom tab bar. Desktop: left sidebar.
export function AppNav() {
  const pathname = usePathname()
  if (pathname.startsWith("/sign-") || pathname.startsWith("/onboarding")) return null
  // The driver login and the revoked-access screen are both dead ends by
  // design: there is nowhere for that person to navigate to.
  if (pathname === "/driver/sign-in" || pathname === "/driver/no-access") return null

  const isDriver = pathname === "/driver" || pathname.startsWith("/driver/")
  const NAV_ITEMS = isDriver ? DRIVER_NAV_ITEMS : OWNER_NAV_ITEMS

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
      </nav>

      {/* Mobile bottom bar */}
      <nav
        aria-label="Main navigation"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-sidebar/95 backdrop-blur md:hidden"
      >
        {/* Column count follows the tier: 8 cramped tabs for the owner, 2 wide
            ones for a driver. A fixed grid-cols-N class cannot do both. */}
        <div className="mx-auto grid max-w-lg" style={{ gridTemplateColumns: `repeat(${NAV_ITEMS.length}, minmax(0, 1fr))` }}>
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
