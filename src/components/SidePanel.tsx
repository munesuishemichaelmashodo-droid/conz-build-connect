import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Menu, Moon, Sun, Truck, HardHat, User, Bell, Shield, Settings as SettingsIcon, LogOut, LifeBuoy, MessageSquareWarning } from "lucide-react";
import { useViewMode } from "@/lib/view-mode";
import { useAuth } from "@/lib/auth";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

export function SidePanel() {
  const [open, setOpen] = useState(false);
  const { theme, toggleTheme, activeRole, setActiveRole, availableRoles } = useViewMode();
  const { is, profile, email } = useAuth();
  const isAdmin = is("admin") || is("super_admin");
  const nav = useNavigate();
  const qc = useQueryClient();

  const close = () => setOpen(false);

  const signOut = async () => {
    close();
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    nav({ to: "/auth", replace: true });
  };

  const switchRole = (r: "customer" | "driver") => {
    setActiveRole(r);
    close();
    nav({ to: r === "driver" ? "/driver" : "/customer" });
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button className="p-2 rounded-md hover:bg-muted text-muted-foreground" aria-label="Open menu">
          <Menu className="w-5 h-5" />
        </button>
      </SheetTrigger>
      <SheetContent side="left" className="w-[300px] p-0 flex flex-col">
        <SheetHeader className="p-5 border-b">
          <SheetTitle className="text-left">
            <div className="font-display font-bold">{profile?.full_name ?? "Account"}</div>
            <div className="text-xs text-muted-foreground font-normal truncate">{email}</div>
          </SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          {/* Screen mode */}
          <Section label="Screen mode">
            <div className="grid grid-cols-2 gap-2">
              <ModeButton active={theme === "light"} onClick={() => theme !== "light" && toggleTheme()} icon={Sun} label="Light" />
              <ModeButton active={theme === "dark"} onClick={() => theme !== "dark" && toggleTheme()} icon={Moon} label="Dark" />
            </div>
          </Section>

          {/* Role switcher */}
          {availableRoles.length > 0 && (
            <Section label="View as">
              <div className="grid grid-cols-2 gap-2">
                {availableRoles.includes("customer") && (
                  <ModeButton active={activeRole === "customer"} onClick={() => switchRole("customer")} icon={HardHat} label="Customer" />
                )}
                {availableRoles.includes("driver") && (
                  <ModeButton active={activeRole === "driver"} onClick={() => switchRole("driver")} icon={Truck} label="Driver" />
                )}
              </div>
              {availableRoles.length === 1 && availableRoles[0] === "customer" && (
                <Link
                  to="/become-driver"
                  onClick={close}
                  className="mt-2 flex items-center justify-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm font-semibold text-primary hover:bg-primary/20"
                >
                  <Truck className="w-4 h-4" /> Become a driver
                </Link>
              )}
            </Section>
          )}

          {/* Settings shortcuts */}
          <Section label="Settings">
            <NavItem to="/profile" icon={User} label="Profile" onClick={close} />
            <NavItem to="/jobs" icon={Bell} label="Notifications & jobs" onClick={close} />
            {isAdmin && <NavItem to="/admin" icon={Shield} label="Admin dashboard" onClick={close} />}
            <NavItem to="/profile" icon={SettingsIcon} label="Account settings" onClick={close} />
          </Section>

          <Section label="Support">
            <NavItem to="/help" icon={LifeBuoy} label="Help & FAQ" onClick={close} />
            <NavItem to="/report" icon={MessageSquareWarning} label="Report an issue" onClick={close} />
          </Section>
        </div>

        <div className="p-4 border-t">
          <button
            onClick={signOut}
            className="w-full flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold hover:bg-muted"
          >
            <LogOut className="w-4 h-4" /> Sign out
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="p-4 border-b">
      <div className="text-[11px] uppercase tracking-widest text-muted-foreground mb-2 font-semibold">{label}</div>
      {children}
    </div>
  );
}

function ModeButton({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: typeof Sun; label: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-1 rounded-lg border p-3 text-xs font-semibold transition",
        active ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted text-muted-foreground"
      )}
    >
      <Icon className="w-5 h-5" />
      {label}
    </button>
  );
}

function NavItem({ to, icon: Icon, label, onClick }: { to: string; icon: typeof User; label: string; onClick: () => void }) {
  return (
    <Link
      to={to as "/profile"}
      onClick={onClick}
      className="flex items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-muted"
    >
      <Icon className="w-4 h-4 text-muted-foreground" />
      <span>{label}</span>
    </Link>
  );
}
