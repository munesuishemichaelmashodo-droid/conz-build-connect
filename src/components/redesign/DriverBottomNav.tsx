import { Link, useRouterState } from "@tanstack/react-router";
import {
  Home,
  PlusCircle,
  ReceiptText,
  Rows3,
  Truck,
  Wallet,
  User,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = { to: string; label: string; icon: LucideIcon; match: (p: string) => boolean };

const DRIVER_ITEMS: NavItem[] = [
  { to: "/driver", label: "Jobs", icon: Rows3, match: (p) => p === "/driver" },
  {
    to: "/jobs",
    label: "Active",
    icon: Truck,
    match: (p) => p === "/jobs" || p.startsWith("/jobs/") || p.startsWith("/chat/"),
  },
  { to: "/wallet", label: "Wallet", icon: Wallet, match: (p) => p.startsWith("/wallet") },
  { to: "/profile", label: "Profile", icon: User, match: (p) => p.startsWith("/profile") },
];

// Customers have no wallet (the wallet screen says it is for drivers), so their
// second tab is booking.
const CUSTOMER_ITEMS: NavItem[] = [
  { to: "/customer", label: "Home", icon: Home, match: (p) => p === "/customer" || p === "/home" },
  {
    to: "/customer/book",
    label: "Book",
    icon: PlusCircle,
    match: (p) => p.startsWith("/customer/book"),
  },
  {
    to: "/jobs",
    label: "My jobs",
    icon: ReceiptText,
    match: (p) => p === "/jobs" || p.startsWith("/jobs/") || p.startsWith("/chat/"),
  },
  { to: "/profile", label: "Profile", icon: User, match: (p) => p.startsWith("/profile") },
];

/**
 * Bottom navigation, fixed to the viewport. Pages that show it reserve space
 * with NAV_SPACE. The current tab is marked with an ink label and a tinted
 * icon well, not an orange button.
 */
function BottomNav({ items, label }: { items: NavItem[]; label: string }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  return (
    <nav
      aria-label={label}
      className="cz-screen fixed inset-x-0 bottom-0 z-30 border-t border-cz-border bg-cz-surface"
      style={{ paddingBottom: "env(safe-area-inset-bottom)", minHeight: 0 }}
    >
      <div className="mx-auto grid max-w-[480px] grid-cols-4 px-2 pt-1.5 pb-2">
        {items.map((it) => {
          const on = it.match(path);
          const Icon = it.icon;
          return (
            <Link
              key={it.to}
              to={it.to}
              aria-current={on ? "page" : undefined}
              className={cn(
                "flex min-h-[52px] flex-col items-center justify-center gap-0.5 rounded-xl text-xs",
                on ? "font-semibold text-cz-text" : "text-cz-muted hover:text-cz-text",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "flex h-7 w-12 items-center justify-center rounded-full",
                  on && "bg-cz-amber-tint text-cz-amber-text",
                )}
              >
                <Icon className="h-[22px] w-[22px]" strokeWidth={2} />
              </span>
              {it.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/** Driver mode: Jobs · Active · Wallet · Profile (/driver, /jobs, /wallet, /profile). */
export function DriverBottomNav() {
  return <BottomNav items={DRIVER_ITEMS} label="Driver sections" />;
}

/** Customer mode: Home · Book · My jobs · Profile (/customer, /customer/book, /jobs, /profile). */
export function CustomerBottomNav() {
  return <BottomNav items={CUSTOMER_ITEMS} label="Customer sections" />;
}

export const NAV_SPACE = "pb-[calc(84px+env(safe-area-inset-bottom))]";
export const DRIVER_NAV_SPACE = NAV_SPACE;
