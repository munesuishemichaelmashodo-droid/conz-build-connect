import { useAuth } from "@/lib/auth";
import type { ReactNode } from "react";
import { NotificationsBell } from "@/components/NotificationsBell";
import { SidePanel } from "@/components/SidePanel";
import { useRouterState } from "@tanstack/react-router";
import { useViewMode } from "@/lib/view-mode";
import { Moon, Sun } from "lucide-react";
import { CustomerBottomNav, DriverBottomNav, NAV_SPACE } from "@/components/redesign/DriverBottomNav";

export function AppShell({ title, children, action }: { title?: string; children: ReactNode; action?: ReactNode }) {
  const { profile } = useAuth();
  const { activeRole, theme, toggleTheme } = useViewMode();
  const path = useRouterState({ select: (st) => st.location.pathname });
  // Driver mode: Wallet and Profile are two of the bottom-nav tabs, so keep
  // the nav visible there too (the other two tabs are redesigned screens).
  const onNavTab = path.startsWith("/wallet") || path.startsWith("/profile");
  const showDriverNav = activeRole === "driver" && onNavTab;
  // Customers have no wallet, so Profile is their only tab in this shell.
  const showCustomerNav = activeRole === "customer" && path.startsWith("/profile");

  return (
    <div className="cz-screen min-h-screen flex flex-col bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto max-w-screen-sm flex items-center justify-between gap-2 px-4 h-14">
          <div className="flex min-w-0 items-center gap-2.5">
            <img
              src="/conz-icon-192.png"
              alt=""
              className="w-8 h-8 shrink-0 rounded-lg"
              width={32}
              height={32}
            />
            <div className="min-w-0 leading-tight">
              <h1 className="truncate text-[17px] font-semibold">{title ?? "Con Z"}</h1>
              {profile && <div className="text-xs text-muted-foreground truncate max-w-[180px]">{profile.full_name}</div>}
            </div>
          </div>
          <div className="flex items-center gap-1">
            {action}
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
            >
              {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </button>
            <NotificationsBell />
            <SidePanel />
          </div>
        </div>
      </header>

      <main className={`flex-1 mx-auto w-full max-w-screen-sm px-4 py-4 ${showDriverNav || showCustomerNav ? NAV_SPACE : "pb-6"}`}>{children}</main>
      {showDriverNav && <DriverBottomNav />}
      {showCustomerNav && <CustomerBottomNav />}
    </div>
  );
}
