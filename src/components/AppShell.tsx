import { Link, useRouterState } from "@tanstack/react-router";
import { Home, Briefcase, Wallet, User, Shield } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useViewMode } from "@/lib/view-mode";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";
import { NotificationsBell } from "@/components/NotificationsBell";
import { SidePanel } from "@/components/SidePanel";

export function AppShell({ title, children, action }: { title?: string; children: ReactNode; action?: ReactNode }) {
  const { is, profile } = useAuth();
  const { activeRole } = useViewMode();
  const isAdmin = is("admin") || is("super_admin");
  const isDriver = activeRole === "driver";
  const path = useRouterState({ select: (s) => s.location.pathname });

  const homeTo = activeRole === "driver" ? "/driver" : activeRole === "customer" ? "/customer" : "/home";

  const tabs = [
    { to: homeTo, icon: Home, label: "Home" },
    { to: "/jobs", icon: Briefcase, label: "Jobs" },
    ...(isDriver ? [{ to: "/wallet", icon: Wallet, label: "Wallet" }] : []),
    ...(isAdmin ? [{ to: "/admin", icon: Shield, label: "Admin" }] : []),
    { to: "/profile", icon: User, label: "Profile" },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="sticky top-0 z-30 border-b bg-card/95 backdrop-blur">
        <div className="mx-auto max-w-screen-sm flex items-center justify-between px-4 h-14">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-md bg-gradient-primary flex items-center justify-center font-display font-bold text-primary-foreground text-sm shadow-lift">CZ</div>
            <div className="leading-tight">
              <div className="font-display font-bold text-base">{title ?? "Con Z"}</div>
              {profile && <div className="text-[11px] text-muted-foreground -mt-0.5 truncate max-w-[160px]">{profile.full_name}</div>}
            </div>
          </div>
          <div className="flex items-center gap-1">
            {action}
            <NotificationsBell />
            <SidePanel />
          </div>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-screen-sm px-4 py-4 pb-24">{children}</main>

      <nav className="fixed bottom-0 inset-x-0 z-30 border-t bg-card/95 backdrop-blur" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div className="mx-auto max-w-screen-sm grid" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0,1fr))` }}>
          {tabs.map((t) => {
            const active = path === t.to || path.startsWith(t.to + "/");
            const Icon = t.icon;
            return (
              <Link key={t.to} to={t.to} className={cn(
                "flex flex-col items-center justify-center py-2.5 gap-0.5 text-[11px] transition-colors",
                active ? "text-primary" : "text-muted-foreground hover:text-foreground"
              )}>
                <Icon className={cn("w-5 h-5", active && "scale-110")} />
                <span className={cn(active && "font-semibold")}>{t.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
