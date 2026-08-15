import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import type { AppRole } from "@/lib/domain";
import { activateAccount } from "@/lib/account.functions";

export type Profile = {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  avatar_url: string | null;
  status: "active" | "suspended" | "banned";
  referral_code: string | null;
};

type AuthState = {
  loading: boolean;
  userId: string | null;
  email: string | null;
  profile: Profile | null;
  roles: AppRole[];
  is: (r: AppRole) => boolean;
  refresh: () => Promise<void>;
};

const Ctx = createContext<AuthState>({
  loading: true,
  userId: null,
  email: null,
  profile: null,
  roles: [],
  is: () => false,
  refresh: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const activate = useServerFn(activateAccount);
  const qc = useQueryClient();

  const load = async (uid: string | null, repair = false) => {
    if (!uid) {
      setProfile(null);
      setRoles([]);
      return;
    }
    if (repair) {
      try {
        await activate();
      } catch (error) {
        console.error("Account activation failed", error);
      }
    }
    const [{ data: p }, { data: r }] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", uid).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", uid),
    ]);
    setProfile((p as Profile) ?? null);
    setRoles(((r ?? []) as { role: AppRole }[]).map((x) => x.role));
  };

  useEffect(() => {
    // 1) subscribe first
    const { data: sub } = supabase.auth.onAuthStateChange(async (event, session) => {
      const uid = session?.user?.id ?? null;
      setUserId(uid);
      setEmail(session?.user?.email ?? null);
      // defer DB read to avoid deadlock
      setTimeout(() => {
        void load(uid, event === "SIGNED_IN" || event === "USER_UPDATED");
      }, 0);
      if (event === "SIGNED_OUT") {
        qc.clear();
      } else if (event === "SIGNED_IN" || event === "USER_UPDATED") {
        qc.invalidateQueries();
      }
    });

    // 2) then check existing
    supabase.auth.getSession().then(({ data }) => {
      const uid = data.session?.user?.id ?? null;
      setUserId(uid);
      setEmail(data.session?.user?.email ?? null);
      void load(uid, !!uid).finally(() => setLoading(false));
    });

    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Presence heartbeat: while signed in and the tab is visible, touch
  // last_active_at every ~45s so other users can see "Online" / "Last seen".
  // Also fires immediately on sign-in and whenever the tab regains focus,
  // so a quick app switch doesn't show a stale "last seen 40s ago".
  useEffect(() => {
    if (!userId) return;
    const beat = () => {
      if (document.visibilityState !== "visible") return;
      void supabase.from("profiles").update({ last_active_at: new Date().toISOString() }).eq("id", userId);
    };
    beat();
    const interval = window.setInterval(beat, 45_000);
    document.addEventListener("visibilitychange", beat);
    window.addEventListener("focus", beat);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", beat);
      window.removeEventListener("focus", beat);
    };
  }, [userId]);

  const value: AuthState = {
    loading,
    userId,
    email,
    profile,
    roles,
    is: (r) => roles.includes(r),
    refresh: () => load(userId),
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
