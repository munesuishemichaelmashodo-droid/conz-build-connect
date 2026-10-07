import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { AppRole } from "@/lib/domain";

type SessionUser = {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown>;
};

export const activateAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: authData, error: authError } = await context.supabase.auth.getUser();
    if (authError || !authData.user) throw new Error("Sign in again to activate your account");

    const user = authData.user as SessionUser;
    const email = user.email ?? null;
    const meta = user.user_metadata ?? {};
    const requestedRole: AppRole = meta.role === "driver" ? "driver" : "customer";
    const fullName =
      typeof meta.full_name === "string" && meta.full_name.trim()
        ? meta.full_name.trim()
        : typeof meta.name === "string" && meta.name.trim()
          ? meta.name.trim()
          : email ?? "Con Z user";
    const phone = typeof meta.phone === "string" ? meta.phone : null;
    const avatarUrl = typeof meta.avatar_url === "string" ? meta.avatar_url : null;

    // This runs on every sign-in and app open. Only create the profile or
    // fill in fields it's missing — never overwrite what the user has since
    // changed on the Profile page (it used to reset their name and phone to
    // the sign-up values every time the app was opened).
    const { data: existingProfile, error: profileReadError } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, phone, email, avatar_url")
      .eq("id", context.userId)
      .maybeSingle();
    if (profileReadError) throw new Error("Could not activate your profile");

    if (!existingProfile) {
      const { error: profileError } = await supabaseAdmin.from("profiles").insert({
        id: context.userId,
        full_name: fullName,
        phone,
        email,
        avatar_url: avatarUrl,
      });
      if (profileError) throw new Error("Could not activate your profile");
    } else {
      const missing: { full_name?: string; phone?: string; email?: string; avatar_url?: string } = {};
      if (!existingProfile.full_name?.trim()) missing.full_name = fullName;
      if (!existingProfile.phone && phone) missing.phone = phone;
      if (existingProfile.email !== email && email) missing.email = email;
      if (!existingProfile.avatar_url && avatarUrl) missing.avatar_url = avatarUrl;
      if (Object.keys(missing).length > 0) {
        const { error: profileError } = await supabaseAdmin.from("profiles").update(missing).eq("id", context.userId);
        if (profileError) throw new Error("Could not activate your profile");
      }
    }

    const { data: roleRows, error: rolesError } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    if (rolesError) throw new Error("Could not check your account access");

    const existingRoles = new Set((roleRows ?? []).map((row) => row.role));
    const rolesToAdd = new Set<AppRole>();
    // Only a base role, and only on first activation. The sign-up metadata
    // ("customer" | "driver") is user-controlled, so it can never yield more:
    // "driver" is an applicant marker — every driver capability is gated on
    // admin verification in the database (is_verified_driver, 0079).
    // Privileged roles are granted only by a super admin with MFA
    // (admin_grant_role); there is no e-mail based bootstrap any more.
    if (existingRoles.size === 0) rolesToAdd.add(requestedRole);

    if (rolesToAdd.size > 0) {
      const { error } = await supabaseAdmin.from("user_roles").upsert(
        [...rolesToAdd].map((role) => ({ user_id: context.userId, role })),
        { onConflict: "user_id,role", ignoreDuplicates: true },
      );
      if (error) throw new Error("Could not activate your account access");
    }

    // First-time activation with a referral code: redeem it. Non-fatal on failure
    // (bad/expired code, self-referral, already redeemed) — signup must not be blocked.
    const referralCode = typeof meta.referral_code === "string" ? meta.referral_code.trim() : "";
    if (existingRoles.size === 0 && referralCode) {
      try {
        await context.supabase.rpc("record_referral", {
          _code: referralCode,
          _referred_role: requestedRole,
        });
      } catch (err) {
        console.error("Referral redemption failed (non-fatal)", err);
      }
    }

    const needsDriverProfile = existingRoles.has("driver") || rolesToAdd.has("driver") || requestedRole === "driver";
    if (needsDriverProfile) {
      const [{ error: driverError }, { error: walletError }] = await Promise.all([
        supabaseAdmin.from("driver_profiles").upsert({ user_id: context.userId }, { onConflict: "user_id", ignoreDuplicates: true }),
        supabaseAdmin.from("wallets").upsert({ user_id: context.userId, balance: 0 }, { onConflict: "user_id", ignoreDuplicates: true }),
      ]);
      if (driverError || walletError) throw new Error("Could not prepare your driver account");
    }

    return { ok: true };
  });