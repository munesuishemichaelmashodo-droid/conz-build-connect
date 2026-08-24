import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Self-service account deletion. Required by Google Play policy for any app
 * that supports account creation.
 *
 * Deleting the auth user outright would CASCADE-delete the profiles row,
 * which would also destroy job/wallet/transaction records shared with other
 * users (e.g. a driver's completed-job history references the customer's
 * profile row). Instead: scrub all personal data, delete any stored ID
 * documents, and permanently ban the account from ever logging in again —
 * financial/audit records stay intact under an anonymised profile.
 */
export const deleteMyAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const userId = context.userId;

    // Scrub personal data on the profile — keep the row so financial
    // records and other users' job history referencing it stay intact.
    // status='banned' matches the real, permanent login ban applied below —
    // the admin Users list filters this out so a deleted account actually
    // disappears from the normal list, per how account deletion is meant
    // to look from the admin side.
    await db
      .from("profiles")
      .update({
        full_name: "Deleted user",
        phone: null,
        email: null,
        avatar_url: null,
        deleted_at: new Date().toISOString(),
        status: "banned",
      })
      .eq("id", userId);

    // Scrub driver-side PII if this account had a driver profile.
    await db
      .from("driver_profiles")
      .update({
        national_id: null,
        national_id_url: null,
        selfie_url: null,
        license_url: null,
        tipper_photo_url: null,
        nationality: null,
        withdrawal_pin_hash: null,
        verification_notes: "Account deleted by user",
      })
      .eq("user_id", userId);

    // Delete the actual ID document files from storage — the most
    // sensitive PII, with no legitimate reason to keep once the account
    // is gone.
    const { data: files } = await db.storage.from("driver-docs").list(userId);
    if (files?.length) {
      await db.storage.from("driver-docs").remove(files.map((f: { name: string }) => `${userId}/${f.name}`));
    }

    // Permanently block login. Not a hard delete of the auth user — that
    // would cascade and destroy shared financial/job records — but this
    // makes the account unusable forever, same end result for the user.
    await db.auth.admin.updateUserById(userId, { ban_duration: "876000h" });

    return { ok: true };
  });
