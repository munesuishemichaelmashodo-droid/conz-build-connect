import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Package, Users, Briefcase, Wallet, X, Bell, MapPin, Check, type LucideIcon } from "lucide-react";
import { enablePushNotifications, pushPermissionState } from "@/lib/push";
import { locateOnce } from "@/lib/geolocate";

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
  const [notifGranted, setNotifGranted] = useState(false);
  const [locationGranted, setLocationGranted] = useState(false);
  const [requesting, setRequesting] = useState<"notif" | "location" | null>(null);
  const slides = role === "driver" ? DRIVER_SLIDES : CUSTOMER_SLIDES;
  const totalSteps = slides.length + 1; // +1 for the permissions screen at the end
  const onPermissionsStep = step === slides.length;

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase.from("profiles").select("onboarding_completed_at").eq("id", userId).maybeSingle();
      if (alive && data && !data.onboarding_completed_at) setVisible(true);
      const state = await pushPermissionState();
      if (alive && state === "granted") setNotifGranted(true);
    })();
    return () => {
      alive = false;
    };
  }, [userId]);

  const requestNotifications = async () => {
    setRequesting("notif");
    const res = await enablePushNotifications(userId);
    setRequesting(null);
    if (res.ok) setNotifGranted(true);
  };

  const requestLocation = async () => {
    setRequesting("location");
    try {
      await locateOnce();
      setLocationGranted(true);
    } catch {
      // user denied or it timed out — they can still grant it later from the job/tracking screens
    } finally {
      setRequesting(null);
    }
  };

  const finish = async () => {
    setVisible(false);
    await supabase.from("profiles").update({ onboarding_completed_at: new Date().toISOString() }).eq("id", userId);
  };

  if (!visible) return null;

  const isLast = step === totalSteps - 1;
  const slide = onPermissionsStep ? null : slides[step];
  const Icon = slide?.icon;

  return (
    <div className="fixed inset-0 z-[60] bg-background flex flex-col">
      <button onClick={finish} className="self-end p-4 text-muted-foreground" aria-label="Skip">
        <X className="w-5 h-5" />
      </button>

      <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
        <AnimatePresence mode="wait">
          {onPermissionsStep ? (
            <motion.div
              key="permissions"
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 }}
              transition={{ duration: 0.25 }}
              className="space-y-5 w-full max-w-xs mx-auto"
            >
              <div className="w-16 h-16 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mx-auto">
                <Bell className="w-8 h-8" />
              </div>
              <h2 className="font-display font-bold text-2xl">One last thing</h2>
              <p className="text-muted-foreground text-sm">
                Turn these on now so job updates and live tracking work right away — you can always change them later in your phone settings.
              </p>

              <button
                type="button"
                onClick={requestNotifications}
                disabled={notifGranted || requesting !== null}
                className="w-full flex items-center gap-3 rounded-xl border p-3 text-left disabled:opacity-70"
              >
                <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <Bell className="w-4 h-4" />
                </div>
                <div className="flex-1">
                  <div className="font-semibold text-sm">Notifications</div>
                  <div className="text-xs text-muted-foreground">
                    {role === "driver" ? "New job offers, messages, disputes" : "Bid updates, driver messages, delivery status"}
                  </div>
                </div>
                {notifGranted ? (
                  <Check className="w-5 h-5 text-success shrink-0" />
                ) : (
                  <span className="text-xs font-semibold text-primary shrink-0">
                    {requesting === "notif" ? "…" : "Enable"}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={requestLocation}
                disabled={locationGranted || requesting !== null}
                className="w-full flex items-center gap-3 rounded-xl border p-3 text-left disabled:opacity-70"
              >
                <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <MapPin className="w-4 h-4" />
                </div>
                <div className="flex-1">
                  <div className="font-semibold text-sm">Location</div>
                  <div className="text-xs text-muted-foreground">
                    {role === "driver" ? "So customers can see you on the way" : "So drivers near you can find your job"}
                  </div>
                </div>
                {locationGranted ? (
                  <Check className="w-5 h-5 text-success shrink-0" />
                ) : (
                  <span className="text-xs font-semibold text-primary shrink-0">
                    {requesting === "location" ? "…" : "Enable"}
                  </span>
                )}
              </button>
            </motion.div>
          ) : (
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 }}
              transition={{ duration: 0.25 }}
              className="space-y-4"
            >
              <div className="w-16 h-16 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mx-auto">
                {Icon && <Icon className="w-8 h-8" />}
              </div>
              <h2 className="font-display font-bold text-2xl">{slide!.title}</h2>
              <p className="text-muted-foreground max-w-xs mx-auto">{slide!.body}</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="p-6 space-y-4">
        <div className="flex items-center justify-center gap-1.5">
          {Array.from({ length: totalSteps }).map((_, i) => (
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
