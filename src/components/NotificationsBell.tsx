import { useEffect, useState } from "react";
import { Archive, Bell, Check, Mail, MailOpen } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  CATEGORY_LABEL,
  groupByDay,
  notificationCategory,
  notificationDestination,
  notificationHint,
  type NotificationCategory,
} from "@/lib/notifications";

type Notification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  job_id: string | null;
  read: boolean;
  created_at: string;
  archived_at?: string | null;
};
function playChime() {
  try {
    if ("vibrate" in navigator) navigator.vibrate(150);
  } catch {}
  try {
    const Ctx =
      (
        window as unknown as {
          AudioContext?: typeof AudioContext;
          webkitAudioContext?: typeof AudioContext;
        }
      ).AudioContext ??
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
  const [filter, setFilter] = useState<NotificationCategory | "all">("all");
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const nav = useNavigate();

  const visible = items.filter((i) => !i.archived_at);
  const unread = visible.filter((i) => !i.read).length;
  const shown = visible.filter((i) => filter === "all" || notificationCategory(i.type) === filter);

  useEffect(() => {
    if (!userId) return;
    let active = true;

    const load = async () => {
      // archived_at exists after migration 0136; before that, fall back to the plain list.
      let res = await supabase
        .from("notifications")
        .select("*")
        .is("archived_at" as never, null)
        .order("created_at", { ascending: false })
        .limit(50);
      if (res.error)
        res = await supabase
          .from("notifications")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(50);
      if (!active) return;
      if (res.error) setLoadError(true);
      else {
        setLoadError(false);
        setItems((res.data ?? []) as Notification[]);
      }
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
          setItems((prev) => [n, ...prev].slice(0, 100));
          toast(n.title, {
            description: [n.body, notificationHint(n)].filter(Boolean).join(" ") || undefined,
          });
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
  }, [userId, reloadKey]);

  const setRead = async (ids: string[], read: boolean) => {
    if (!ids.length) return;
    const before = items;
    setItems((prev) => prev.map((i) => (ids.includes(i.id) ? { ...i, read } : i)));
    const { error } = await supabase.from("notifications").update({ read }).in("id", ids);
    if (error) {
      // Put the previous read state back and say so.
      setItems((prev) =>
        prev.map((i) =>
          ids.includes(i.id)
            ? { ...i, read: before.find((b) => b.id === i.id)?.read ?? i.read }
            : i,
        ),
      );
      toast.error("Could not update notifications. Please try again.");
    }
  };

  const markAll = () =>
    setRead(
      visible.filter((i) => !i.read).map((i) => i.id),
      true,
    );

  // Archive hides a notification. It never deletes it, and it never touches the job, payment or evidence it was about.
  const setArchived = async (ids: string[], archived: boolean) => {
    const at = archived ? new Date().toISOString() : null;
    setItems((prev) => prev.map((i) => (ids.includes(i.id) ? { ...i, archived_at: at } : i)));
    const { error } = await supabase
      .from("notifications")
      .update({ archived_at: at } as never)
      .in("id", ids);
    if (error) {
      setItems((prev) =>
        prev.map((i) =>
          ids.includes(i.id) ? { ...i, archived_at: archived ? null : i.archived_at } : i,
        ),
      );
      toast.error("Could not update notifications. Please try again.");
      return false;
    }
    return true;
  };

  const archiveOne = async (n: Notification) => {
    if (await setArchived([n.id], true)) {
      toast("Notification cleared", {
        action: { label: "Undo", onClick: () => void setArchived([n.id], false) },
      });
    }
  };

  const clearShown = async () => {
    const ids = shown.map((i) => i.id);
    if (!ids.length) return;
    const scope = filter === "all" ? "" : ` in ${CATEGORY_LABEL[filter]}`;
    if (
      !window.confirm(
        `Clear ${ids.length} notification${ids.length === 1 ? "" : "s"}${scope}? Your jobs, payments, messages and records are not affected.`,
      )
    )
      return;
    if (await setArchived(ids, true)) {
      toast(`${ids.length} cleared`, {
        action: { label: "Undo", onClick: () => void setArchived(ids, false) },
      });
    }
  };

  const openItem = async (n: Notification) => {
    if (!n.read) await setRead([n.id], true);
    setOpen(false);
    const dest = notificationDestination(n);
    if (dest) nav({ to: dest.to as never, params: dest.params as never });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="relative flex h-11 w-11 items-center justify-center rounded-lg hover:bg-muted text-muted-foreground"
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        >
          <Bell aria-hidden className="w-5 h-5" />
          {unread > 0 && (
            <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full bg-primary text-primary-foreground text-[11px] font-semibold flex items-center justify-center">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>
      </PopoverTrigger>
      {open && <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setOpen(false)} />}
      <PopoverContent align="end" className="z-50 w-[calc(100vw-1.5rem)] max-w-sm p-0">
        <div className="flex items-center justify-between px-3 py-2 border-b gap-2">
          <div className="font-semibold text-sm">Notifications</div>
          <div className="flex items-center gap-1">
            <button
              onClick={markAll}
              disabled={!unread}
              className="min-h-11 rounded-lg px-2 text-xs font-medium text-cz-amber-text hover:bg-muted disabled:text-muted-foreground inline-flex items-center gap-1"
            >
              <Check className="w-3.5 h-3.5" /> Mark all read
            </button>
            <button
              onClick={clearShown}
              disabled={!shown.length}
              aria-label={`Clear ${shown.length} shown notification${shown.length === 1 ? "" : "s"}`}
              className="min-h-11 rounded-lg px-2 text-xs font-medium text-muted-foreground hover:bg-muted disabled:opacity-50 inline-flex items-center gap-1"
            >
              <Archive className="w-3.5 h-3.5" /> Clear shown
            </button>
          </div>
        </div>
        <div
          className="flex gap-1 overflow-x-auto border-b px-2 py-1.5"
          role="tablist"
          aria-label="Notification categories"
        >
          {(["all", "jobs", "payments", "verification", "account"] as const).map((c) => (
            <button
              key={c}
              role="tab"
              aria-selected={filter === c}
              onClick={() => setFilter(c)}
              className={cn(
                "shrink-0 rounded-full px-2.5 py-1 text-xs font-medium",
                filter === c
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              {CATEGORY_LABEL[c]}
            </button>
          ))}
        </div>
        <div className="max-h-[65vh] overflow-auto">
          {shown.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground" role="status">
              {loadError && visible.length === 0 ? (
                <>
                  <p>Could not load your notifications.</p>
                  <button
                    onClick={() => setReloadKey((k) => k + 1)}
                    className="mt-2 min-h-11 rounded-lg px-3 text-sm font-semibold text-foreground underline underline-offset-4"
                  >
                    Try again
                  </button>
                </>
              ) : visible.length === 0 ? (
                "You're all caught up"
              ) : (
                `No ${CATEGORY_LABEL[filter].toLowerCase()} notifications`
              )}
            </div>
          ) : (
            groupByDay(shown).map((g) => (
              <section key={g.label} aria-label={g.label}>
                <div className="sticky top-0 bg-card/95 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {g.label}
                </div>
                {g.items.map((n) => (
                  <div
                    key={n.id}
                    className={cn(
                      "flex items-start border-b last:border-0 hover:bg-muted/60 transition-colors",
                      !n.read && "bg-primary/5",
                    )}
                  >
                    <button
                      onClick={() => openItem(n)}
                      className="flex-1 min-w-0 text-left px-3 py-2.5"
                    >
                      <div className="flex items-start gap-2">
                        {!n.read && (
                          <span
                            aria-label="Unread"
                            className="mt-1.5 w-2 h-2 rounded-full bg-primary shrink-0"
                          />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{n.title}</div>
                          {n.body && (
                            <div className="text-xs text-muted-foreground line-clamp-2">
                              {n.body}
                            </div>
                          )}
                          {notificationHint(n) && (
                            <div className="text-xs font-medium mt-0.5">{notificationHint(n)}</div>
                          )}
                          <div className="text-[10px] text-muted-foreground mt-0.5">
                            {CATEGORY_LABEL[notificationCategory(n.type)]} ·{" "}
                            {new Date(n.created_at).toLocaleString("en-GB", {
                              timeZone: "Africa/Harare",
                            })}
                          </div>
                        </div>
                      </div>
                    </button>
                    <div className="flex shrink-0 items-center py-0.5 pr-1">
                      <button
                        onClick={() => setRead([n.id], !n.read)}
                        aria-label={n.read ? "Mark as unread" : "Mark as read"}
                        className="flex h-11 w-11 items-center justify-center rounded text-muted-foreground hover:bg-muted"
                      >
                        {n.read ? <Mail className="w-4 h-4" /> : <MailOpen className="w-4 h-4" />}
                      </button>
                      <button
                        onClick={() => archiveOne(n)}
                        aria-label="Clear this notification"
                        className="flex h-11 w-11 items-center justify-center rounded text-muted-foreground hover:bg-muted"
                      >
                        <Archive className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </section>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
