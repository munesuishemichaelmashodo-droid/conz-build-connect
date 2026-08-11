import { useEffect, useState } from "react";
import { Bell, Check } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type Notification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  job_id: string | null;
  read: boolean;
  created_at: string;
};
function playChime() {
  try {
    if ("vibrate" in navigator) navigator.vibrate(150);
  } catch {}
  try {
    const Ctx =
      (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
        .AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = 1046; // higher pitch than the job-offer alert, so they're distinguishable
    o.connect(g);
    g.connect(ctx.destination);
    g.gain.setValueAtTime(0.25, ctx.currentTime);
    o.start();
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    o.stop(ctx.currentTime + 0.4);
  } catch {}
}
export function NotificationsBell() {
  const { userId } = useAuth();
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const nav = useNavigate();

  const unread = items.filter((i) => !i.read).length;

  useEffect(() => {
    if (!userId) return;
    let active = true;

    const load = async () => {
      const { data } = await supabase
        .from("notifications")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(30);
      if (active && data) setItems(data as Notification[]);
    };
    load();

    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const n = payload.new as Notification;
          setItems((prev) => [n, ...prev].slice(0, 30));
          toast(n.title, { description: n.body ?? undefined });
          playChime();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const n = payload.new as Notification;
          setItems((prev) => prev.map((i) => (i.id === n.id ? n : i)));
        },
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [userId]);

  const markAll = async () => {
    if (!unread) return;
    const ids = items.filter((i) => !i.read).map((i) => i.id);
    setItems((prev) => prev.map((i) => ({ ...i, read: true })));
    await supabase.from("notifications").update({ read: true }).in("id", ids);
  };

  const openItem = async (n: Notification) => {
    if (!n.read) {
      setItems((prev) => prev.map((i) => (i.id === n.id ? { ...i, read: true } : i)));
      await supabase.from("notifications").update({ read: true }).eq("id", n.id);
    }
    setOpen(false);

    // Route by notification type first — many notifications (admin actions,
    // wallet events, disputes/reports) have no job_id at all, so relying on
    // job_id alone left most of these going nowhere when tapped.
    switch (n.type) {
      case "dispute_raised":
      case "dispute_overdue":
        return nav({ to: "/admin/disputes" });
      case "report_filed":
        return nav({ to: "/admin/reports" });
      case "wallet_topup":
      case "wallet_withdrawal":
        return nav({ to: "/wallet" });
      case "driver_verification":
        return nav({ to: "/profile" });
      case "user_status_changed":
        return nav({ to: "/profile" });
      case "new_message":
        if (n.job_id) return nav({ to: "/chat/$jobId", params: { jobId: n.job_id } });
        break;
      default:
        break;
    }

    if (n.job_id) nav({ to: "/jobs/$id", params: { id: n.job_id } });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="relative p-2 rounded-md hover:bg-muted text-muted-foreground"
          aria-label="Notifications"
        >
          <Bell className="w-4 h-4" />
          {unread > 0 && (
            <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold flex items-center justify-center">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <div className="font-semibold text-sm">Notifications</div>
          <button
            onClick={markAll}
            disabled={!unread}
            className="text-xs text-primary disabled:text-muted-foreground inline-flex items-center gap-1"
          >
            <Check className="w-3 h-3" /> Mark all read
          </button>
        </div>
        <div className="max-h-96 overflow-auto">
          {items.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              You're all caught up
            </div>
          ) : (
            items.map((n) => (
              <button
                key={n.id}
                onClick={() => openItem(n)}
                className={cn(
                  "w-full text-left px-3 py-2.5 border-b last:border-0 hover:bg-muted transition-colors",
                  !n.read && "bg-primary/5",
                )}
              >
                <div className="flex items-start gap-2">
                  {!n.read && (
                    <span className="mt-1.5 w-2 h-2 rounded-full bg-primary shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{n.title}</div>
                    {n.body && (
                      <div className="text-xs text-muted-foreground line-clamp-2">
                        {n.body}
                      </div>
                    )}
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {new Date(n.created_at).toLocaleString()}
                    </div>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
