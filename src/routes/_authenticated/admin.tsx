import { createFileRoute, Outlet, Link, useRouterState, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { LayoutDashboard, Users, ShieldCheck, Gavel, Settings as SettingsIcon, TrendingUp, ScrollText, BookOpen, MessageSquareWarning, Gift, MapPin, HandCoins, PackageSearch } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated/admin")({
  beforeLoad: async ({ location }) => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) throw redirect({ to: "/auth" });
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", u.user.id);
    const list = (roles ?? []).map((r: { role: string }) => r.role);
    if (!list.includes("admin") && !list.includes("super_admin")) {
      throw redirect({ to: "/home" });
    }
    // Admin pages open with password + role. Super-admin MONEY actions
    // (credits, approvals, refunds, reversals) additionally require an MFA
    // (aal2) session, enforced in the database (0074/0076); the UI sends the
    // admin to /mfa when an action needs it.
  },
  component: AdminLayout,
});

type Tab = { to: string; label: string; icon: typeof Users; exact?: boolean; superOnly?: boolean; group: string };

// Same sections and the same super-admin filter as before; grouped for the
// desktop sidebar. Visibility here is convenience only: every screen and RPC
// still enforces its own role checks.
const TABS: Tab[] = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard, exact: true, group: "Overview" },
  { to: "/admin/revenue", label: "Revenue", icon: TrendingUp, superOnly: true, group: "Money" },
  { to: "/admin/approvals", label: "Approvals", icon: HandCoins, superOnly: true, group: "Money" },
  { to: "/admin/ledger", label: "Ledger", icon: BookOpen, superOnly: true, group: "Money" },
  { to: "/admin/users", label: "Users", icon: Users, group: "People" },
  { to: "/admin/verifications", label: "Verify", icon: ShieldCheck, group: "People" },
  { to: "/admin/disputes", label: "Disputes", icon: Gavel, group: "People" },
  { to: "/admin/reports", label: "Reports", icon: MessageSquareWarning, group: "People" },
  { to: "/admin/referrals", label: "Referrals", icon: Gift, group: "People" },
  { to: "/admin/sourcing", label: "Sourcing", icon: PackageSearch, group: "Supply" },
  { to: "/admin/supply-coverage", label: "Supply", icon: MapPin, group: "Supply" },
  { to: "/admin/audit", label: "Audit", icon: ScrollText, superOnly: true, group: "System" },
  { to: "/admin/settings", label: "Settings", icon: SettingsIcon, superOnly: true, group: "System" },
];
const GROUPS = ["Overview", "Money", "People", "Supply", "System"];

// Current section: ink text on a raised neutral fill, never orange (DESIGN.md).
const ON = "bg-muted text-foreground font-semibold shadow-[inset_0_0_0_1px_var(--cz-border-strong)]";
const OFF = "text-muted-foreground hover:bg-muted hover:text-foreground";

function AdminLayout() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { is } = useAuth();
  const isSuper = is("super_admin");
  const visibleTabs = TABS.filter((t) => !t.superOnly || isSuper);
  const isActive = (t: Tab) => (t.exact ? path === t.to : path.startsWith(t.to));
  return (
    <AppShell title="Con Z Control" wide>
      <div className="lg:grid lg:grid-cols-[208px_minmax(0,1fr)] lg:gap-8">
        <nav aria-label="Admin sections" className="hidden lg:block">
          <div className="sticky top-20 space-y-4">
            {GROUPS.map((g) => {
              const items = visibleTabs.filter((t) => t.group === g);
              if (!items.length) return null;
              return (
                <div key={g}>
                  <div className="px-3 pb-1 text-xs font-semibold text-muted-foreground">{g}</div>
                  <ul className="space-y-0.5">
                    {items.map((t) => {
                      const Icon = t.icon;
                      const active = isActive(t);
                      return (
                        <li key={t.to}>
                          <Link
                            to={t.to as "/admin"}
                            aria-current={active ? "page" : undefined}
                            className={cn("flex min-h-11 items-center gap-2.5 rounded-lg px-3 text-sm", active ? ON : OFF)}
                          >
                            <Icon aria-hidden className="h-4 w-4 shrink-0" />
                            {t.label}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        </nav>

        <div className="min-w-0">
          <nav aria-label="Admin sections" className="-mx-4 mb-4 overflow-x-auto px-4 lg:hidden">
            <div className="flex min-w-max gap-2 pb-1">
              {visibleTabs.map((t) => {
                const Icon = t.icon;
                const active = isActive(t);
                return (
                  <Link
                    key={t.to}
                    to={t.to as "/admin"}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex min-h-11 items-center gap-1.5 rounded-lg border px-3 text-sm transition-colors",
                      active ? cn(ON, "border-foreground") : cn(OFF, "border-border bg-card"),
                    )}
                  >
                    <Icon aria-hidden className="h-4 w-4" />
                    {t.label}
                  </Link>
                );
              })}
            </div>
          </nav>
          <Outlet />
        </div>
      </div>
    </AppShell>
  );
}
