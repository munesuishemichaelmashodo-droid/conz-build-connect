import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Package, Users, Briefcase, Wallet, X, type LucideIcon } from "lucide-react";

type Slide = { icon: LucideIcon; title: string; body: string };

const CUSTOMER_SLIDES: Slide[] = [
  {
    icon: Package,
    title: "Welcome to Con Z",
    body: "Book construction materials — sand, stone, soil — and get them delivered by a verified driver, tracked the whole way.",
  },
  {
    icon: Users,
    title: "You're in control",
    body: "Set your quantity and location, drivers bid their price, you pick the offer that works. As you use the app, we'll point out what each new screen does.",
  },
];

const DRIVER_SLIDES: Slide[] = [
  {
    icon: Briefcase,
    title: "Welcome to Con Z",
    body: "Find delivery jobs near you and bid your own price — no one assigns work to you, you choose what to take.",
  },
  {
    icon: Wallet,
    title: "You're in control",
    body: "Your first job is commission-free, and you get paid automatically once delivery is confirmed. As you use the app, we'll point out what each new screen does.",
  },
];

export function OnboardingWalkthrough({ userId, role }: { userId: string; role: "customer" | "driver" }) {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);
  const slides = role === "driver" ? DRIVER_SLIDES : CUSTOMER_SLIDES;

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase.from("profiles").select("onboarding_completed_at").eq("id", userId).maybeSingle();
      if (alive && data && !data.onboarding_completed_at) setVisible(true);
    })();
    return () => {
      alive = false;
    };
  }, [userId]);

  const finish = async () => {
    setVisible(false);
    await supabase.from("profiles").update({ onboarding_completed_at: new Date().toISOString() }).eq("id", userId);
  };

  if (!visible) return null;

  const isLast = step === slides.length - 1;
  const slide = slides[step];
  const Icon = slide.icon;

  return (
    <div className="fixed inset-0 z-[60] bg-background flex flex-col">
      <button onClick={finish} className="self-end p-4 text-muted-foreground" aria-label="Skip">
        <X className="w-5 h-5" />
      </button>

      <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.25 }}
            className="space-y-4"
          >
            <div className="w-16 h-16 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mx-auto">
              <Icon className="w-8 h-8" />
            </div>
            <h2 className="font-display font-bold text-2xl">{slide.title}</h2>
            <p className="text-muted-foreground max-w-xs mx-auto">{slide.body}</p>
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="p-6 space-y-4">
        <div className="flex items-center justify-center gap-1.5">
          {slides.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all ${i === step ? "w-6 bg-primary" : "w-1.5 bg-muted"}`}
            />
          ))}
        </div>
        <Button
          onClick={() => (isLast ? finish() : setStep((s) => s + 1))}
          className="w-full h-12 font-display font-bold uppercase tracking-wide"
        >
          {isLast ? "Get started" : "Next"}
        </Button>
      </div>
    </div>
  );
}
