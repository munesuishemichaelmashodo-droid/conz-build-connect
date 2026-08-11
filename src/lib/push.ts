import { supabase } from "@/integrations/supabase/client";

// Public — this key is meant to be public, it's how the browser knows which
// server is allowed to push to it. The matching private key stays server-side
// in the send-push Edge Function's secrets.
const VAPID_PUBLIC_KEY = "BGm0pMiD2vry3j9Dz26lqNo-uNKhJZVn2LfUJV_7i-FHkcTBNqorbjn3nhlhYea6qb0KLQx3n0Hut7UjUkj4Xu0";

function urlBase64ToUint8Array(base64String: string): BufferSource {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0))).buffer as BufferSource;
}

export function pushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js");
  } catch {
    return null;
  }
}

export async function pushPermissionState(): Promise<NotificationPermission | "unsupported"> {
  if (!pushSupported()) return "unsupported";
  return Notification.permission;
}

/**
 * Requests notification permission (must be called from a user gesture,
 * e.g. a button tap) and, if granted, subscribes this device and saves the
 * subscription so the send-push Edge Function can reach it.
 */
export async function enablePushNotifications(userId: string): Promise<{ ok: boolean; error?: string }> {
  if (!pushSupported()) return { ok: false, error: "Push notifications aren't supported on this device/browser." };

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return { ok: false, error: "Notifications permission was not granted." };
  }

  const reg = await registerServiceWorker();
  if (!reg) return { ok: false, error: "Could not set up notifications for this app." };

  await navigator.serviceWorker.ready;

  let subscription = await reg.pushManager.getSubscription();
  if (!subscription) {
    subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }

  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    return { ok: false, error: "Could not read subscription details." };
  }

  const { error } = await (supabase.from("push_subscriptions" as any) as any).upsert(
    {
      user_id: userId,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
    },
    { onConflict: "endpoint" },
  );

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
