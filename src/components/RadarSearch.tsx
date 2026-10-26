import { motion, useReducedMotion } from "framer-motion";
import { Truck } from "lucide-react";
import { useEffect, useState } from "react";

// Only what is true while a job is open. nearbyDrivers comes from
// count_available_verified_drivers: approved, active drivers with enough balance
// for the commission, anywhere (not "online" or "near"). No wait time is shown,
// because nothing measures one.
const MESSAGES = [
  "Your request is open to drivers near you…",
  "Drivers send their own offers…",
  "You'll be notified when an offer arrives…",
];

export function RadarSearch({ nearbyDrivers }: { nearbyDrivers?: number }) {
  const [i, setI] = useState(0);
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    if (reduceMotion) return;
    const t = setInterval(() => setI((v) => (v + 1) % MESSAGES.length), 2500);
    return () => clearInterval(t);
  }, [reduceMotion]);

  return (
    <div className="relative rounded-3xl overflow-hidden dark bg-gradient-dark text-white p-8 shadow-lift">
      <div className="relative mx-auto w-64 h-64 flex items-center justify-center">
        {/* Radar rings */}
        {[0, 1, 2].map((ring) => (
          <motion.div
            key={ring}
            className="absolute inset-0 rounded-full border border-primary/40"
            initial={{ scale: 0.2, opacity: 0.8 }}
            animate={{ scale: 1, opacity: 0 }}
            transition={{
              duration: 3,
              repeat: reduceMotion ? 0 : Infinity,
              delay: ring,
              ease: "easeOut",
            }}
          />
        ))}
        {/* Sweep */}
        <motion.div
          className="absolute inset-0 rounded-full"
          style={{
            background:
              "conic-gradient(from 0deg, transparent 0deg, var(--color-primary) 30deg, transparent 60deg)",
            opacity: 0.35,
          }}
          animate={{ rotate: 360 }}
          transition={{ duration: 2.4, repeat: reduceMotion ? 0 : Infinity, ease: "linear" }}
        />
        {/* Orbiting trucks */}
        {[0, 1, 2].map((t) => (
          <motion.div
            key={t}
            className="absolute w-8 h-8 rounded-full bg-primary/90 text-primary-foreground flex items-center justify-center shadow-lift"
            animate={{ rotate: 360 }}
            transition={{
              duration: 6 + t * 1.5,
              repeat: reduceMotion ? 0 : Infinity,
              ease: "linear",
              delay: t * 0.8,
            }}
            style={{
              transformOrigin: `0 ${70 + t * 20}px`,
              top: "50%",
              left: "50%",
              marginTop: -(70 + t * 20),
              marginLeft: -16,
            }}
          >
            <Truck className="w-4 h-4" />
          </motion.div>
        ))}
        {/* Center pin */}
        <div className="relative z-10 w-16 h-16 rounded-full bg-primary flex items-center justify-center shadow-lift">
          <div className="w-3 h-3 rounded-full bg-primary-foreground animate-pulse" />
        </div>
      </div>

      <motion.div
        key={i}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.4 }}
        className="text-center mt-6 font-display text-lg tracking-wide"
      >
        {MESSAGES[i]}
      </motion.div>
      <div className="text-center text-xs text-white/75 mt-2 space-y-0.5">
        {typeof nearbyDrivers === "number" &&
          (nearbyDrivers > 0 ? (
            <div>
              <span className="text-cz-amber-text font-semibold">{nearbyDrivers}</span> approved{" "}
              {nearbyDrivers === 1 ? "driver" : "drivers"} can take this job
            </div>
          ) : (
            <div>
              No approved driver can take this job right now. Your request stays open, and the Con Z
              team can see it.
            </div>
          ))}
      </div>
    </div>
  );
}
