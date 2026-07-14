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

    const { error: profileError } = await supabaseAdmin.from("profiles").upsert(
      {
        id: context.userId,
        full_name: fullName,
        phone,
        email,
        avatar_url: avatarUrl,
      },
      { onConflict: "id", ignoreDuplicates: false },
    );
    if (profileError) throw new Error("Could not activate your profile");

    const { data: roleRows, error: rolesError } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    if (rolesError) throw new Error("Could not check your account access");

    const existingRoles = new Set((roleRows ?? []).map((row) => row.role));
    const rolesToAdd = new Set<AppRole>();
    if (existingRoles.size === 0) rolesToAdd.add(requestedRole);
    if (email?.toLowerCase() === "munesuishemichaelmashodo@gmail.com") {
      rolesToAdd.add("super_admin");
      rolesToAdd.add("admin");
      rolesToAdd.add("customer");
      rolesToAdd.add("driver");
    }

    if (rolesToAdd.size > 0) {
      const { error } = await supabaseAdmin.from("user_roles").upsert(
        [...rolesToAdd].map((role) => ({ user_id: context.userId, role })),
        { onConflict: "user_id,role", ignoreDuplicates: true },
      );
      if (error) throw new Error("Could not activate your account access");
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