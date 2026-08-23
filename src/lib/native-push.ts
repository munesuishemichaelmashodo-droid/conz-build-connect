import { supabase } from "@/integrations/supabase/client";
import { Capacitor } from "@capacitor/core";

/**
 * Native push (Android/iOS via Capacitor + FCM/APNs), the counterpart to
 * src/lib/push.ts's Web Push implementation. Kept as a separate module —
 * not merged into push.ts — because @capacitor/push-notifications must
 * never be imported on web: it's a native-only package, so every entry
 * point here dynamically imports it and is safe to call unconditionally
 * from shared UI (PushNotificationPrompt.tsx branches on isNativePlatform()
 * to decide which of the two modules to call, not which functions inside
 * one shared module).
 *
 * Delivery itself is NOT a second notification system: the same
 * `notifications` table insert that already triggers Web Push (via
 * trg_send_push_on_notification -> send-push Edge Function) is extended
 * server-side to also look up device_tokens and deliver via FCM/APNs.
 * Nothing here creates a new event source — it only gets a token onto a
 * device so that existing event can reach it.
 */

export type NativePlatform = "android" | "ios";

export function isNativePlatform(): boolean {
  // @capacitor/core is safe to import in web builds too (same as
  // capacitor-oauth-bridge.ts) — it just reports false there. No dynamic
  // import needed for this one, unlike the native-only plugin package below.
  return Capacitor.isNativePlatform();
}

function currentPlatform(): NativePlatform | null {
  if (!isNativePlatform()) return null;
  const p = Capacitor.getPlatform();
  return p === "android" || p === "ios" ? p : null;
}

export function nativePushSupported(): boolean {
  return currentPlatform() !== null;
}

export async function nativePushPermissionState(): Promise<
  "granted" | "denied" | "prompt" | "prompt-with-rationale" | "unsupported"
> {
  if (!nativePushSupported()) return "unsupported";
  const { PushNotifications } = await import("@capacitor/push-notifications");
  const status = await PushNotifications.checkPermissions();
  return status.receive;
}

async function saveToken(userId: string, platform: NativePlatform, token: string) {
  const { error } = await (supabase.from("device_tokens" as never) as any).upsert(
    { user_id: userId, platform, token, active: true },
    { onConflict: "platform,token" },
  );
  return error;
}

/**
 * Requests permission (must be called from a user gesture, matching
 * enablePushNotifications() in push.ts) and registers this device.
 * Resolves once the token has been saved, or rejects with an error
 * message — same {ok, error} shape as the web version.
 */
export async function enableNativePushNotifications(userId: string): Promise<{ ok: boolean; error?: string }> {
  const platform = currentPlatform();
  if (!platform) return { ok: false, error: "Native push isn't available on this device." };

  const { PushNotifications } = await import("@capacitor/push-notifications");

  // Android 13+ (API 33+) requires this explicit runtime prompt — the
  // POST_NOTIFICATIONS manifest entry alone does not grant it.
  const current = await PushNotifications.checkPermissions();
  let receive = current.receive;
  if (receive === "prompt" || receive === "prompt-with-rationale") {
    const requested = await PushNotifications.requestPermissions();
    receive = requested.receive;
  }
  if (receive !== "granted") {
    return { ok: false, error: "Notifications permission was not granted." };
  }

  return new Promise((resolve) => {
    let settled = false;
    const done = (result: { ok: boolean; error?: string }) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };

    PushNotifications.addListener("registration", async (token) => {
      const error = await saveToken(userId, platform, token.value);
      done(error ? { ok: false, error: error.message } : { ok: true });
    });
    PushNotifications.addListener("registrationError", (err) => {
      done({ ok: false, error: err.error ?? "Registration failed." });
    });

    PushNotifications.register();
  });
}

/**
 * Call once at app startup for an already-authenticated native session
 * (mirrors registerOAuthRedirectListener()'s wiring in __root.tsx).
 * No-ops on web. Handles:
 *  - token refresh (the "registration" event fires again with a new
 *    token any time the OS rotates it — re-saving is a plain upsert,
 *    so this naturally updates the existing row rather than duplicating it)
 *  - notification tap, routed through the app's normal router instead of
 *    a separate navigation system
 * Does not request permission — that stays gated behind the user's
 * explicit tap on "Enable notifications", same as the web flow.
 */
export async function registerNativePushListeners(
  getUserId: () => Promise<string | null>,
  navigate: (path: string) => void,
): Promise<void> {
  if (!nativePushSupported()) return;
  const platform = currentPlatform();
  if (!platform) return;

  const { PushNotifications } = await import("@capacitor/push-notifications");

  PushNotifications.addListener("registration", async (token) => {
    const userId = await getUserId();
    if (!userId) return; // not logged in yet; enableNativePushNotifications() covers the logged-in registration path
    await saveToken(userId, platform, token.value);
  });

  // Payload shape matches send-push's notification_payload for Web Push
  // (see send-push Edge Function): { title, body, url }. Tapping opens
  // the same route the web notification's click handler would.
  PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
    const url = (action.notification.data as { url?: string } | undefined)?.url;
    navigate(url && typeof url === "string" ? url : "/");
  });
}

/**
 * Deactivates this device's token(s) for the current user — call on
 * logout so a signed-out device stops receiving that user's pushes.
 * Deletes rather than merely flips `active`, matching the "avoid
 * permanently accumulating dead tokens" requirement; re-registering on
 * next login is a plain upsert either way.
 */
export async function deactivateNativePushForCurrentUser(): Promise<void> {
  if (!nativePushSupported()) return;
  const userId = (await supabase.auth.getUser()).data.user?.id;
  if (!userId) return;
  await (supabase.from("device_tokens" as never) as any).delete().eq("user_id", userId);
}
