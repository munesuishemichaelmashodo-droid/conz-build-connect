// Sends a push notification (Web Push + FCM) to a user's devices.
// Triggered by tg_send_push_on_notification on every notifications INSERT.
//
// SECURITY (audit C4): this function is verify_jwt=false (the Postgres
// trigger calls it server-to-server via pg_net, which cannot attach a user
// JWT). Without an application-level check it accepted {user_id,title,body}
// from anyone on the internet and delivered branded pushes to any user. It
// now requires the shared secret in the `x-conz-push-secret` header, matched
// (constant-time) against public.app_secrets.push_hook_secret — the same
// value the trigger sends. Arbitrary callers get 401 before anything is sent.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import webpush from "npm:web-push@3.6.7";
import { SignJWT, importPKCS8 } from "npm:jose@6.2.10";
import { createClient } from "jsr:@supabase/supabase-js@2";

const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY");
const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY");
const vapidSubject = Deno.env.get("VAPID_SUBJECT") ?? "mailto:support@conz.co.zw";

if (vapidPublic && vapidPrivate) {
  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);
}

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---- FCM (Android native push) --------------------------------------

type FcmServiceAccount = { project_id: string; client_email: string; private_key: string };

let fcmAccount: FcmServiceAccount | null = null;
let fcmAccountParseError: string | null = null;
try {
  const raw = Deno.env.get("FCM_SERVICE_ACCOUNT_JSON");
  if (raw) fcmAccount = JSON.parse(raw);
} catch (e) {
  fcmAccountParseError = e instanceof Error ? e.message : String(e);
}

let cachedFcmToken: { token: string; expiresAt: number } | null = null;

async function getFcmAccessToken(account: FcmServiceAccount): Promise<string> {
  if (cachedFcmToken && cachedFcmToken.expiresAt > Date.now() + 30_000) {
    return cachedFcmToken.token;
  }
  const key = await importPKCS8(account.private_key, "RS256");
  const now = Math.floor(Date.now() / 1000);
  const jwt = await new SignJWT({
    scope: "https://www.googleapis.com/auth/firebase.messaging",
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(account.client_email)
    .setSubject(account.client_email)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    throw new Error(`FCM token exchange failed: ${res.status} ${await res.text()}`);
  }
  const json = await res.json();
  cachedFcmToken = { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return cachedFcmToken.token;
}

async function sendFcm(
  account: FcmServiceAccount,
  token: string,
  title: string,
  body: string,
  data: Record<string, string>,
): Promise<"ok" | "invalid" | "error"> {
  try {
    const accessToken = await getFcmAccessToken(account);
    const res = await fetch(
      `https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ message: { token, notification: { title, body }, data } }),
      },
    );
    if (res.ok) return "ok";
    const errText = await res.text();
    if (res.status === 404 || errText.includes("UNREGISTERED") || errText.includes("invalid-registration-token")) {
      return "invalid";
    }
    console.error("[send-push] fcm send failed", res.status, errText);
    return "error";
  } catch (err) {
    console.error("[send-push] fcm send threw", err instanceof Error ? err.message : err);
    return "error";
  }
}

// ---- Handler -----------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // C4: authorize the caller BEFORE doing anything. The only legitimate
  // caller is the Postgres notifications trigger, which sends the shared
  // secret. A missing/wrong secret is rejected without sending anything.
  const providedSecret = req.headers.get("x-conz-push-secret") ?? "";
  const { data: secretRow, error: secretErr } = await supabase
    .from("app_secrets")
    .select("value")
    .eq("key", "push_hook_secret")
    .maybeSingle();
  if (secretErr) {
    console.error("[send-push] could not load push_hook_secret", secretErr.message);
    return new Response("unavailable", { status: 503 });
  }
  const expected = secretRow?.value ?? "";
  if (!expected || !timingSafeEqual(providedSecret, expected)) {
    return new Response("unauthorized", { status: 401 });
  }

  let payload: { user_id?: string; title?: string; body?: string; notification_id?: string; job_id?: string | null };
  try {
    payload = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { user_id, title, body, job_id, notification_id } = payload;
  if (!user_id || !title) {
    return new Response(JSON.stringify({ ok: false, error: "missing_fields" }), { status: 200 });
  }

  const url = job_id ? `/jobs/${job_id}` : "/";
  let webSent = 0;
  let nativeSent = 0;

  // ---- Web Push ----
  if (!vapidPublic || !vapidPrivate) {
    console.error("[send-push] VAPID keys not configured — skipping web push");
  } else {
    const { data: subs, error } = await supabase
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("user_id", user_id);

    if (error) {
      console.error("[send-push] failed to load web push subscriptions", error.message);
    } else if (subs && subs.length > 0) {
      const notificationPayload = JSON.stringify({ title, body: body ?? "", url });
      const staleIds: string[] = [];
      await Promise.all(
        subs.map(async (sub) => {
          try {
            await webpush.sendNotification(
              { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
              notificationPayload,
            );
            webSent++;
          } catch (err: any) {
            if (err?.statusCode === 404 || err?.statusCode === 410) {
              staleIds.push(sub.id);
            } else {
              console.error("[send-push] web push send failed", err?.statusCode, err?.message);
            }
          }
        }),
      );
      if (staleIds.length > 0) {
        await supabase.from("push_subscriptions").delete().in("id", staleIds);
      }
    }
  }

  // ---- Native push (Android via FCM) ----
  if (fcmAccountParseError) {
    console.error("[send-push] FCM_SERVICE_ACCOUNT_JSON is set but invalid JSON:", fcmAccountParseError);
  } else if (!fcmAccount) {
    // Not configured yet — graceful no-op.
  } else {
    const { data: tokens, error } = await supabase
      .from("device_tokens")
      .select("id, token, platform")
      .eq("user_id", user_id)
      .eq("active", true)
      .eq("platform", "android");

    if (error) {
      console.error("[send-push] failed to load device_tokens", error.message);
    } else if (tokens && tokens.length > 0) {
      const invalidIds: string[] = [];
      await Promise.all(
        tokens.map(async (t) => {
          const result = await sendFcm(fcmAccount!, t.token, title, body ?? "", {
            url,
            notification_id: notification_id ?? "",
            job_id: job_id ?? "",
          });
          if (result === "ok") nativeSent++;
          else if (result === "invalid") invalidIds.push(t.id);
        }),
      );
      if (invalidIds.length > 0) {
        await supabase.from("device_tokens").delete().in("id", invalidIds);
      }
    }
  }

  return new Response(
    JSON.stringify({ ok: true, web_sent: webSent, native_sent: nativeSent }),
    { status: 200 },
  );
});
