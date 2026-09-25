import { Link, useRouterState } from "@tanstack/react-router";
import { Rows3, Truck, Wallet, User } from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  { to: "/driver", label: "Jobs", icon: Rows3, match: (p: string) => p === "/driver" },
  { to: "/jobs", label: "Active", icon: Truck, match: (p: string) => p === "/jobs" || p.startsWith("/jobs/") || p.startsWith("/chat/") },
  { to: "/wallet", label: "Wallet", icon: Wallet, match: (p: string) => p.startsWith("/wallet") },
  { to: "/profile", label: "Profile", icon: User, match: (p: string) => p.startsWith("/profile") },
] as const;

/**
 * Driver-mode bottom navigation: Jobs · Active · Wallet · Profile, mapped
 * onto the existing routes (/driver, /jobs, /wallet, /profile). Fixed to
 * the bottom of the viewport; pages that show it reserve space with
 * `pb-[76px]` (see DRIVER_NAV_SPACE).
 */
export function DriverBottomNav() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  return (
    <nav
      aria-label="Driver sections"
      className="cz-screen fixed inset-x-0 bottom-0 z-40 border-t border-[#25272b] bg-[#16171a]"
      style={{ paddingBottom: "env(safe-area-inset-bottom)", minHeight: 0 }}
    >
      <div className="mx-auto grid max-w-[480px] grid-cols-4 px-2 pt-1.5 pb-2">
        {ITEMS.map((it) => {
          const on = it.match(path);
          const Icon = it.icon;
          return (
            <Link
              key={it.to}
              to={it.to}
              aria-current={on ? "page" : undefined}
              className={cn(
                "min-h-[52px] flex flex-col items-center justify-center gap-1 text-xs rounded-xl",
                on ? "text-cz-amber font-semibold" : "text-cz-muted",
              )}
            >
              <Icon className="w-[22px] h-[22px]" strokeWidth={2} />
              {it.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export const DRIVER_NAV_SPACE = "pb-[calc(84px+env(safe-area-inset-bottom))]";
