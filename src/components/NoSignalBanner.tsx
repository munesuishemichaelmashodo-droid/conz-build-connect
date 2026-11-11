import { useEffect, useRef } from "react";
import { WifiOff } from "lucide-react";
import { toast } from "sonner";
import { noSignalCopy, useOnlineStatus } from "@/lib/online-status";

/** A calm banner for signed-in screens while the phone has no connection; says what still works and what will not. */
export function NoSignalBanner() {
  const online = useOnlineStatus();
  const wasOffline = useRef(false);
  useEffect(() => {
    if (!online) wasOffline.current = true;
    else if (wasOffline.current) {
      wasOffline.current = false;
      toast.success("Back online");
    }
  }, [online]);
  if (online) return null;
  const copy = noSignalCopy();
  return (
    <div
      role="status"
      className="sticky top-0 z-[60] flex items-start gap-2.5 border-b border-cz-border bg-cz-surface-2 px-4 py-2.5 text-sm text-cz-text"
    >
      <WifiOff aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-cz-muted" />
      <div>
        <div className="font-semibold">{copy.title}</div>
        <div className="text-[13px] text-cz-muted">{copy.detail}</div>
      </div>
    </div>
  );
}
