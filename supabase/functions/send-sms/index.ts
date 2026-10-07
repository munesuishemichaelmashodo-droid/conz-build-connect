// Supabase Auth "Send SMS" hook -> Africa's Talking
//
// Global SMS aggregators (Twilio, Vonage) both failed to deliver OTP codes
// to Zimbabwean numbers during testing. Africa's Talking specializes in
// African carrier routing and is far more reliable for this corridor.
// Supabase doesn't support it as a built-in provider, so this function
// stands in as a custom "Send SMS" webhook instead.
//
// SECURITY (audit F8 / H9): the deployed version (v8, not previously in git)
// verified the webhook signature only IF a secret happened to be set — it
// failed OPEN, letting anyone send arbitrary OTP-styled SMS at the owner's
// cost. This version fails CLOSED: no secret, bad signature, stale or
// replayed timestamp, or a non-allowed destination country => nothing sent.
//
// Required secrets (Supabase Dashboard -> Edge Functions -> Secrets):
//   SEND_SMS_HOOK_SECRET          - "v1,whsec_..." from the Send SMS hook (REQUIRED)
//   AFRICASTALKING_USERNAME       - Africa's Talking app username
//   AFRICASTALKING_API_KEY        - Africa's Talking API key
//   AFRICASTALKING_SENDER_ID      - optional alphanumeric sender ID (e.g. "ConZ")
//   SMS_ALLOWED_COUNTRY_CODES     - optional, comma separated (default "263")
// verify_jwt must stay false (Supabase Auth calls it with the webhook signature).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { allowedDestination, verifyStandardWebhook } from "./verify.ts";

function hookError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: { http_code: status, message } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return hookError(405, "Method not allowed");

  const hookSecret = Deno.env.get("SEND_SMS_HOOK_SECRET");
  if (!hookSecret) {
    // Fail closed: never send unauthenticated SMS.
    console.error("[send-sms] SEND_SMS_HOOK_SECRET is not set; refusing to send");
    return hookError(500, "SMS hook is not configured");
  }

  const rawBody = await req.text();
  const ok = await verifyStandardWebhook(
    {
      id: req.headers.get("webhook-id"),
      timestamp: req.headers.get("webhook-timestamp"),
      signature: req.headers.get("webhook-signature"),
    },
    rawBody,
    hookSecret,
  );
  if (!ok) return hookError(401, "Invalid webhook signature");

  let event: { user?: { phone?: string }; sms?: { otp?: string } };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return hookError(400, "Invalid JSON");
  }

  const phone = event?.user?.phone;
  const otp = event?.sms?.otp;
  if (!phone || !otp || !/^\d{4,10}$/.test(otp)) return hookError(400, "Missing phone or otp in payload");

  const allowed = (Deno.env.get("SMS_ALLOWED_COUNTRY_CODES") ?? "263").split(",").map((s) => s.trim()).filter(Boolean);
  const toNumber = allowedDestination(phone, allowed);
  if (!toNumber) return hookError(400, "SMS to this country is not supported");

  const username = Deno.env.get("AFRICASTALKING_USERNAME");
  const apiKey = Deno.env.get("AFRICASTALKING_API_KEY");
  const senderId = Deno.env.get("AFRICASTALKING_SENDER_ID");
  if (!username || !apiKey) return hookError(500, "Africa's Talking credentials not configured");

  const form = new URLSearchParams();
  form.set("username", username);
  form.set("to", toNumber);
  form.set("message", `Your Con Z verification code is ${otp}`);
  if (senderId) form.set("from", senderId);

  try {
    const atRes = await fetch("https://api.africastalking.com/version1/messaging", {
      method: "POST",
      headers: { apiKey, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: form.toString(),
      signal: AbortSignal.timeout(15000),
    });
    const text = await atRes.text();
    let parsed: { SMSMessageData?: { Recipients?: Array<{ status?: string }> } } | null = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* non-JSON response */
    }
    const recipients = parsed?.SMSMessageData?.Recipients;
    const sent = atRes.ok && Array.isArray(recipients) && recipients.some((r) => r.status === "Success");
    if (!sent) {
      console.error("[send-sms] Africa's Talking failed", atRes.status, text.slice(0, 300));
      return hookError(500, "SMS provider error");
    }
    return new Response(null, { status: 200 });
  } catch (err) {
    console.error("[send-sms] request failed", err);
    return hookError(500, "SMS provider unreachable");
  }
});
