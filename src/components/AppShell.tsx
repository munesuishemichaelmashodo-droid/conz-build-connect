import { useAuth } from "@/lib/auth";
import type { ReactNode } from "react";
import { NotificationsBell } from "@/components/NotificationsBell";
import { SidePanel } from "@/components/SidePanel";

export function AppShell({ title, children, action }: { title?: string; children: ReactNode; action?: ReactNode }) {
  const { profile } = useAuth();

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="sticky top-0 z-30 border-b bg-card/95 backdrop-blur">
        <div className="mx-auto max-w-screen-sm flex items-center justify-between px-4 h-14">
          <div className="flex items-center gap-2">
            <img
              src="/conz-logo.png"
              alt="CON Z"
              className="w-8 h-8 rounded-md object-cover"
              width={32}
              height={32}
            />
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

      <main className="flex-1 mx-auto w-full max-w-screen-sm px-4 py-4 pb-6">{children}</main>
    </div>
  );
}
