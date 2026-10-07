import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Self-service account deletion. Required by Google Play policy for any app
 * that supports account creation.
 *
 * Deleting the auth user outright would CASCADE-delete the profiles row,
 * which would also destroy job/wallet/transaction records shared with other
 * users and needed for financial reconciliation. Instead (migration 0081):
 *   1. refuse while money or work is in flight (account_deletion_blockers);
 *   2. scrub all personal data in one transaction (anonymize_deleted_account)
 *      — financial and audit records are retained under the anonymous id;
 *   3. delete the person's KYC documents and chat media from storage;
 *   4. replace the auth e-mail, ban the login and revoke every session.
 * Each step's error is checked; nothing is silently skipped.
 */

export type DeleteAccountResult =
  | { ok: true; warnings: string[] }
  | { ok: false; blockers: string[]; message: string };

const BLOCKER_TEXT: Record<string, string> = {
  wallet_balance_positive: "withdraw the money in your wallet",
  wallet_balance_owed: "settle the amount you owe in your wallet",
  commission_held: "finish the jobs that are holding commission",
  withdrawal_pending: "wait for your pending withdrawal to be processed (or cancel it)",
  topup_pending: "wait for your pending top-up to be processed (or cancel it)",
  active_jobs: "complete or cancel your open and active jobs",
  payment_in_progress: "wait for payments in progress or refunds owed to you to finish",
  open_disputes: "wait for your open disputes to be resolved",
};

export const deleteMyAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DeleteAccountResult> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 0081 RPCs aren't in the generated types yet.
    const db = supabaseAdmin as any;
    const userId = context.userId;

    const { data: blockers, error: blockersError } = await db.rpc("account_deletion_blockers", { _uid: userId });
    if (blockersError) throw new Error("Could not check your account. Please try again.");
    if (Array.isArray(blockers) && blockers.length > 0) {
      const steps = blockers.map((b: string) => BLOCKER_TEXT[b] ?? b);
      return {
        ok: false,
        blockers,
        message: `Before we can delete your account, please ${steps.join("; ")}.`,
      };
    }

    const { data: scrubbed, error: scrubError } = await db.rpc("anonymize_deleted_account", { _uid: userId });
    if (scrubError) throw new Error("Could not delete your account. Please try again or contact support.");

    const warnings: string[] = [];
    const docs: string[] = scrubbed?.driver_docs ?? [];
    const media: string[] = scrubbed?.chat_media ?? [];
    if (docs.length) {
      const { error } = await db.storage.from("driver-docs").remove(docs);
      if (error) warnings.push("documents");
    }
    if (media.length) {
      const { error } = await db.storage.from("chat-media").remove(media);
      if (error) warnings.push("chat media");
    }

    // Remove the e-mail from the auth record too and block the login forever.
    const { error: banError } = await db.auth.admin.updateUserById(userId, {
      email: `deleted-${userId}@deleted.conz.invalid`,
      email_confirm: true,
      user_metadata: {},
      ban_duration: "876000h",
    });
    if (banError) warnings.push("login ban");

    // Revoke every existing session (all devices), not just this browser.
    const authHeader = getRequest()?.headers.get("authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (token) {
      const { error: signOutError } = await db.auth.admin.signOut(token, "global");
      if (signOutError) warnings.push("session revocation");
    }

    if (warnings.length) {
      console.error(`[account-deletion] ${userId}: incomplete steps: ${warnings.join(", ")}`);
    }
    return { ok: true, warnings };
  });
