import { useEffect, useState } from "react";
import { Bell, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { enablePushNotifications, pushPermissionState, pushSupported } from "@/lib/push";

const DISMISS_KEY = "conz_push_prompt_dismissed";

export function PushNotificationPrompt() {
  const { userId } = useAuth();
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!userId || !pushSupported()) return;
      if (localStorage.getItem(DISMISS_KEY) === "1") return;
      const state = await pushPermissionState();
      if (mounted && state === "default") setVisible(true);
    })();
    return () => {
      mounted = false;
    };
  }, [userId]);

  if (!visible || !userId) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, "1");
    setVisible(false);
  };

  const enable = async () => {
    setLoading(true);
    const res = await enablePushNotifications(userId);
    setLoading(false);
    if (res.ok) {
      toast.success("Notifications enabled — you'll be alerted even with the app closed.");
      setVisible(false);
    } else {
      toast.error(res.error ?? "Could not enable notifications");
      dismiss();
    }
  };

  return (
    <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 font-display font-bold uppercase text-sm tracking-wide">
          <Bell className="w-4 h-4 text-primary" /> Turn on notifications
        </div>
        <button onClick={dismiss} className="text-muted-foreground shrink-0" aria-label="Dismiss">
          <X className="w-4 h-4" />
        </button>
      </div>
      <p className="text-sm text-muted-foreground">
        Get alerted about new jobs, messages, and payments even when Con Z isn't open.
      </p>
      <Button onClick={enable} disabled={loading} size="sm" className="w-full">
        {loading ? "Enabling…" : "Enable notifications"}
      </Button>
    </div>
  );
}
