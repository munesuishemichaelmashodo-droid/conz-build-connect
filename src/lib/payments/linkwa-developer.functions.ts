import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type {
  LinkwaCallResult,
  LinkwaSandboxCallInput,
} from "@/lib/payments/linkwa-developer.server";

// Linkwa SANDBOX console (super admin, staging Preview only): run one documented Developer API call and see Linkwa's real
// answer, redacted. Used to collect evidence for docs/payments/LINKWA-PAYOUT-API-CONTRACT-2026-11-25.md (tests T1–T8).
// It changes nothing in ConZ's own records (no driver account, payable or payout row is written); every call is written
// to admin_audit_log with Linkwa's status code. Refused wherever linkwaDeveloperConfig() refuses (production database,
// production deployment, live key, collection key reused).

export type LinkwaDeveloperStatus = { available: boolean; reason: string | null };

async function superAdminOnly(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic RPC/insert on a server-only admin client
  const db = supabaseAdmin as any;
  const { data } = await db.rpc("has_role", { _user_id: userId, _role: "super_admin" });
  return { ok: data === true, db };
}

/** Whether the Developer key is configured and allowed here. Reason codes only, never values. */
export const adminLinkwaDeveloperStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<LinkwaDeveloperStatus> => {
    const { ok } = await superAdminOnly(context.userId);
    if (!ok) return { available: false, reason: "forbidden" };
    const { linkwaDeveloperConfig } = await import("@/lib/payments/linkwa-config.server");
    const c = linkwaDeveloperConfig();
    return c.ok ? { available: true, reason: null } : { available: false, reason: c.reason };
  });

export type LinkwaSandboxCallResponse =
  | {
      ok: true;
      action: string;
      sentAt: string;
      auditLogged: boolean;
      httpStatus: number;
      transportError: LinkwaCallResult["transportError"];
      /** Linkwa's redacted JSON body, as text. */
      bodyJson: string;
    }
  | { ok: false; error: string };

export const adminLinkwaSandboxCall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: Partial<LinkwaSandboxCallInput>) => data)
  .handler(async ({ data, context }): Promise<LinkwaSandboxCallResponse> => {
    const { validateSandboxCall, createLinkwaDeveloperClient } =
      await import("@/lib/payments/linkwa-developer.server");
    const v = validateSandboxCall(data);
    if (!v.ok) return { ok: false, error: v.error };
    const { ok, db } = await superAdminOnly(context.userId);
    if (!ok) return { ok: false, error: "forbidden" };
    const { linkwaDeveloperConfig } = await import("@/lib/payments/linkwa-config.server");
    const c = linkwaDeveloperConfig();
    if (!c.ok) return { ok: false, error: c.reason };

    const client = createLinkwaDeveloperClient(c.config);
    const i = v.value;
    const sentAt = new Date().toISOString();
    let r: LinkwaCallResult;
    switch (i.action) {
      case "link_user":
        r = await client.linkUser({
          firstName: i.firstName as string,
          lastName: i.lastName as string,
          phoneNumber: i.phoneNumber as string,
          email: i.email as string,
        });
        break;
      case "link_wallet":
        r = await client.linkWallet({
          externalUserId: i.externalUserId as string,
          phoneNumber: i.phoneNumber as string,
        });
        break;
      case "payout":
        r = await client.instructPayout({
          externalUserId: i.externalUserId as string,
          externalWalletId: i.externalWalletId as string,
          amount: i.amount as number,
        });
        break;
      case "balance":
        r = await client.getBalance();
        break;
      default:
        r = await client.getStatement(10);
    }

    const { error } = await db.from("admin_audit_log").insert({
      actor_id: context.userId,
      action: "linkwa_sandbox_call",
      reason: i.reason,
      meta: {
        linkwa_action: i.action,
        http_status: r.httpStatus,
        transport_error: r.transportError,
        amount: i.action === "payout" ? i.amount : null,
        external_user_id: i.externalUserId ?? null,
        external_wallet_id: i.externalWalletId ?? null,
      },
    });
    return {
      ok: true,
      action: i.action,
      sentAt,
      auditLogged: !error,
      httpStatus: r.httpStatus,
      transportError: r.transportError,
      bodyJson: JSON.stringify(r.body ?? null),
    };
  });
