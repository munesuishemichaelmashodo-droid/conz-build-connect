import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/oauth-callback")({
  ssr: false,
  component: AuthCallbackPage,
});

function AuthCallbackPage() {
  const navigate = useNavigate();
  const [message, setMessage] = useState("Securing your session…");

  useEffect(() => {
    let cancelled = false;
    const readNext = () => {
      try {
        const stashed = sessionStorage.getItem("conz.postAuthNext");
        sessionStorage.removeItem("conz.postAuthNext");
        if (stashed && stashed.startsWith("/") && !stashed.startsWith("//")) return stashed;
      } catch {
        /* ignore */
      }
      return null;
    };
    const finish = async () => {
      for (let i = 0; i < 20; i += 1) {
        const { data } = await supabase.auth.getSession();
        if (cancelled) return;
        if (data.session) {
          const next = readNext();
          if (next) {
            window.location.replace(next);
          } else {
            navigate({ to: "/home", replace: true });
          }
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      if (!cancelled) setMessage("Session was not completed. Please try Google sign-in again.");
    };
    void finish();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-5">
      <div className="text-center space-y-3">
        <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto" />
        <h1 className="font-display font-bold text-xl uppercase">Con Z Login</h1>
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}