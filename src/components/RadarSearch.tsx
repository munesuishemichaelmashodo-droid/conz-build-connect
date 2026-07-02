import { motion } from "framer-motion";
import { Truck } from "lucide-react";
import { useEffect, useState } from "react";

const MESSAGES = [
  "Searching for nearby tipper trucks…",
  "Finding the best available driver…",
  "Matching you with a verified truck…",
];

export function RadarSearch({
  etaMinutes = 5,
  nearbyDrivers,
}: {
  etaMinutes?: number;
  nearbyDrivers?: number;
}) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((v) => (v + 1) % MESSAGES.length), 2500);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="relative rounded-3xl overflow-hidden bg-gradient-dark text-white p-8 shadow-lift">
      <div className="relative mx-auto w-64 h-64 flex items-center justify-center">
        {/* Radar rings */}
        {[0, 1, 2].map((ring) => (
          <motion.div
            key={ring}
            className="absolute inset-0 rounded-full border border-primary/40"
            initial={{ scale: 0.2, opacity: 0.8 }}
            animate={{ scale: 1, opacity: 0 }}
            transition={{ duration: 3, repeat: Infinity, delay: ring, ease: "easeOut" }}
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
          transition={{ duration: 2.4, repeat: Infinity, ease: "linear" }}
        />
        {/* Orbiting trucks */}
        {[0, 1, 2].map((t) => (
          <motion.div
            key={t}
            className="absolute w-8 h-8 rounded-full bg-primary/90 text-primary-foreground flex items-center justify-center shadow-lift"
            animate={{ rotate: 360 }}
            transition={{ duration: 6 + t * 1.5, repeat: Infinity, ease: "linear", delay: t * 0.8 }}
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
      <div className="text-center text-xs text-white/60 mt-2 space-y-0.5">
        <div>
          Estimated wait: <span className="text-primary font-semibold">{etaMinutes}–{etaMinutes + 5} min</span>
        </div>
        {typeof nearbyDrivers === "number" && (
          <div>{nearbyDrivers} verified drivers nearby</div>
        )}
      </div>
    </div>
  );
}
