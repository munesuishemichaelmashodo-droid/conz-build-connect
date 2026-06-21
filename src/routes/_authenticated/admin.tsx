import { createFileRoute, Outlet, Link, useRouterState, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { LayoutDashboard, Users, ShieldCheck, Gavel, Settings as SettingsIcon, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated/admin")({
  beforeLoad: async () => {
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
  },
  component: AdminLayout,
});

const TABS: { to: string; label: string; icon: typeof Users; exact?: boolean; superOnly?: boolean }[] = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { to: "/admin/revenue", label: "Revenue", icon: TrendingUp, superOnly: true },
  { to: "/admin/users", label: "Users", icon: Users },
  { to: "/admin/verifications", label: "Verify", icon: ShieldCheck },
  { to: "/admin/disputes", label: "Disputes", icon: Gavel },
  { to: "/admin/settings", label: "Settings", icon: SettingsIcon },
];

function AdminLayout() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { is } = useAuth();
  const isSuper = is("super_admin");
  const visibleTabs = TABS.filter((t) => !t.superOnly || isSuper);
  return (
    <AppShell title="Con Z Control">
      <div className="-mx-4 px-4 overflow-x-auto mb-4">
        <div className="flex gap-2 min-w-max pb-1">
          {visibleTabs.map((t) => {
            const active = t.exact ? path === t.to : path.startsWith(t.to);
            const Icon = t.icon;
            return (
              <Link
                key={t.to}
                to={t.to as "/admin"}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors",
                  active
                    ? "bg-primary text-primary-foreground border-primary shadow-lift"
                    : "bg-card text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {t.label}
              </Link>
            );
          })}
        </div>
      </div>
      <Outlet />
    </AppShell>
  );
}
