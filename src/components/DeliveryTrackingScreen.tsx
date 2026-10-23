import { useState } from "react";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  Copy,
  Image as ImageIcon,
  KeyRound,
  MapPin,
  Package,
  Radio,
  Share2,
  Truck,
} from "lucide-react";

type TrackData = {
  status: string;
  material: string;
  custom_material: string | null;
  quantity_m3: number;
  delivery_address: string | null;
  driver_name: string | null;
  live: { lat: number; lng: number; updated_at: string } | null;
};

type Variant = "pickup" | "loading" | "travelling" | "stale" | "stopped" | "completed" | "pin";

const variants: Record<Variant, { label: string; stage: number; title: string; body: string }> = {
  pickup: { label: "Travelling to pickup", stage: 0, title: "Webster is heading to pickup", body: "They’ll load your river sand at Driver arranges pickup and send a photo of the loaded truck before leaving." },
  loading: { label: "Loading materials", stage: 1, title: "Your river sand is being loaded", body: "Webster has arrived at the pickup point. We’ll let you know when the truck is ready to leave." },
  travelling: { label: "On the way to you", stage: 2, title: "Your delivery is on the way", body: "Webster is travelling to your site with your river sand. Keep an eye on the live route below." },
  stale: { label: "Location update delayed", stage: 2, title: "The truck is still on the way", body: "We haven’t received a location update in a little while. The last position is shown below — we’ll keep checking.", },
  stopped: { label: "Location sharing stopped", stage: 2, title: "Webster stopped sharing location", body: "Location sharing was active earlier but is currently unavailable. We’ll show a new position if sharing resumes.", },
  completed: { label: "Delivered", stage: 3, title: "Your delivery is complete", body: "The river sand was delivered to your site. Thanks for building with ConZ.", },
  pin: { label: "PIN ready", stage: 3, title: "Your delivery PIN is ready", body: "Share this PIN with the driver only when the load has arrived and you’re ready to confirm delivery.", },
};

function MapPreview({ variant, live }: { variant: Variant; live: TrackData["live"] }) {
  const hasLocation = variant === "travelling" || variant === "stale";
  return (
    <div className="relative h-[246px] overflow-hidden rounded-[24px] bg-[#e9e5dc] text-[#1d2928]">
      <div className="absolute inset-0 opacity-70" style={{ backgroundImage: "linear-gradient(24deg, transparent 46%, #c7c8bf 47%, #c7c8bf 49%, transparent 50%), linear-gradient(112deg, transparent 43%, #d2d0c7 44%, #d2d0c7 47%, transparent 48%), linear-gradient(#f7f4ec 1px, transparent 1px), linear-gradient(90deg, #f7f4ec 1px, transparent 1px)", backgroundSize: "180px 140px, 230px 170px, 28px 28px, 28px 28px" }} />
      <div className="absolute left-[18%] top-[44%] h-3/4 w-1/2 rotate-[28deg] rounded-full bg-[#d5e1d3]/80 blur-[1px]" />
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 390 246" fill="none" aria-hidden="true">
        <path d="M-20 205C55 190 81 118 148 130C219 144 217 57 410 51" stroke="#ffffff" strokeWidth="12" />
        <path d="M-20 205C55 190 81 118 148 130C219 144 217 57 410 51" stroke="#ff983d" strokeWidth="4" strokeDasharray={hasLocation ? "1 0" : "7 8"} />
      </svg>
      <div className="absolute left-4 top-4 rounded-full bg-white/90 px-3 py-2 text-[11px] font-semibold shadow-sm">Harare · delivery route</div>
      <div className="absolute bottom-4 left-4 flex items-center gap-2 rounded-xl bg-white/90 px-3 py-2 text-[11px] shadow-sm"><span className="size-2 rounded-full bg-[#ff7716]" /> Pickup · Driver arranges</div>
      <div className="absolute right-4 top-4 flex items-center gap-2 rounded-xl bg-[#151311] px-3 py-2 text-xs font-semibold text-white shadow-lg"><MapPin className="size-3.5 text-[#ff7716]" /> Delivery site</div>
      {hasLocation && <div className="absolute left-[53%] top-[42%] grid size-12 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-4 border-white bg-[#151311] shadow-xl"><Truck className="size-5 text-[#ff7716]" /></div>}
      {!hasLocation && variant !== "completed" && <div className="absolute left-[22%] top-[62%] grid size-11 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-white bg-[#ff7716] shadow-xl"><Truck className="m-auto size-5 text-[#151311]" /></div>}
      <div className="absolute bottom-4 right-4 grid size-10 place-items-center rounded-full border-[3px] border-white bg-[#ff7716] shadow-xl"><MapPin className="size-5 text-[#151311]" /></div>
      {variant === "completed" && <div className="absolute inset-0 grid place-items-center bg-[#151311]/10"><div className="flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold shadow-lg"><CheckCircle2 className="size-4 text-[#2f9e5e]" /> Delivered</div></div>}
    </div>
  );
}

function Steps({ active }: { active: number }) {
  const items = ["Pickup", "Load", "Deliver", "PIN"];
  return <div className="grid grid-cols-4 gap-2" aria-label="Delivery progress">{items.map((item, index) => <div key={item} className="flex min-w-0 flex-col gap-2"><div className={`h-1 rounded-full ${index <= active ? "bg-[#ff7716]" : "bg-[#302a26]"}`} /><div className={`flex items-center gap-1.5 text-[11px] font-semibold ${index <= active ? "text-[#f7f3ef]" : "text-[#736b65]"}`}><span className={`grid size-5 shrink-0 place-items-center rounded-full border text-[10px] ${index < active ? "border-[#ff7716] bg-[#ff7716] text-[#151311]" : index === active ? "border-[#ff7716] text-[#ff7716]" : "border-[#4a413b]"}`}>{index < active ? <Check className="size-3" /> : index + 1}</span><span className="truncate">{item}</span></div></div>)}</div>;
}

export function DeliveryTrackingScreen({ data }: { data: TrackData }) {
  const [variant, setVariant] = useState<Variant>(data.status === "completed" ? "completed" : "pickup");
  const [copied, setCopied] = useState(false);
  const current = variants[variant];
  const live = variant === "travelling" && data.live;
  const material = data.custom_material || data.material.replaceAll("_", " ");
  const driver = data.driver_name?.split(" ")[0] || "Webster";

  const copyPin = async () => { await navigator.clipboard?.writeText("406532"); setCopied(true); setTimeout(() => setCopied(false), 1600); };

  return <main className="cz-screen min-h-screen bg-[#010101] pb-10 text-[#fcfaf8]">
    <header className="mx-auto flex max-w-[620px] items-center justify-between px-5 pb-4 pt-[max(18px,env(safe-area-inset-top))]"><button aria-label="Go back" className="grid size-10 place-items-center rounded-full bg-[#171412] text-white"><ArrowLeft className="size-5" /></button><div className="text-center"><p className="font-display text-xl font-semibold tracking-tight">ConZ</p><p className="text-[10px] text-[#8f8781]">Construction Made Easy</p></div><button aria-label="Share tracking link" className="grid size-10 place-items-center rounded-full bg-[#ff7716] text-[#151311]"><Share2 className="size-5" /></button></header>
    <div className="mx-auto flex max-w-[620px] flex-col gap-4 px-4">
      <div className="flex items-center justify-between"><div><p className="text-[11px] font-semibold uppercase tracking-[.16em] text-[#8f8781]">Delivery tracking</p><h1 className="mt-1 font-display text-[25px] font-semibold capitalize">{material} <span className="text-[#8f8781]">· {data.quantity_m3} m³</span></h1></div><button onClick={() => navigator.share?.({ title: "ConZ delivery", text: "Track my ConZ delivery" })} className="flex items-center gap-2 rounded-full border border-[#342d28] px-3 py-2 text-xs font-semibold"><Share2 className="size-3.5 text-[#ff7716]" /> Share</button></div>
      <MapPreview variant={variant} live={data.live} />
      <div className="rounded-[24px] border border-[#231e1a] bg-[#110e0c] p-4"><Steps active={current.stage} /><div className="mt-5 flex items-start gap-3"><div className={`mt-1 grid size-9 shrink-0 place-items-center rounded-full ${variant === "completed" ? "bg-[#12301f] text-[#7fe0a6]" : variant === "stale" || variant === "stopped" ? "bg-[#3a1e12] text-[#ffb08a]" : "bg-[#2a1407] text-[#ffa366]"}`}>{variant === "completed" ? <CheckCircle2 className="size-5" /> : variant === "stale" || variant === "stopped" ? <CircleAlert className="size-5" /> : <Truck className="size-5" />}</div><div><p className="text-[11px] font-semibold uppercase tracking-[.14em] text-[#ff9a5a]">{current.label}</p><h2 className="mt-1 font-display text-[31px] font-semibold leading-[1.02] tracking-tight">{current.title}</h2><p className="mt-3 text-sm leading-6 text-[#a79e97]">{current.body}</p></div></div>
        {variant === "travelling" && <div className="mt-4 grid grid-cols-2 gap-2"><div className="rounded-2xl bg-[#1c1815] p-3"><p className="text-[10px] uppercase tracking-wider text-[#8f8781]">Estimated arrival</p><p className="mt-1 text-lg font-semibold">10:45–11:15</p></div><div className="rounded-2xl bg-[#1c1815] p-3"><p className="text-[10px] uppercase tracking-wider text-[#8f8781]">Trip progress</p><p className="mt-1 text-lg font-semibold">64% <span className="text-xs font-normal text-[#8f8781]">· live</span></p></div></div>}
        {variant === "stale" && <div className="mt-4 flex items-start gap-2 rounded-2xl bg-[#3a1e12] p-3 text-xs leading-5 text-[#ffb08a]"><Clock3 className="mt-0.5 size-4 shrink-0" /> Last location update 14 minutes ago. ETA and progress are hidden until a fresh location arrives.</div>}
        {variant === "stopped" && <div className="mt-4 flex items-start gap-2 rounded-2xl bg-[#3a1e12] p-3 text-xs leading-5 text-[#ffb08a]"><Radio className="mt-0.5 size-4 shrink-0" /> Sharing was active earlier. The driver has stopped sharing their location for now.</div>}
      </div>
      <section className="rounded-[24px] border border-[#5a2a20] bg-[#2a1407] p-4"><div className="flex items-start gap-3"><div className="grid size-9 shrink-0 place-items-center rounded-full bg-[#ff7716] text-[#151311]"><KeyRound className="size-5" /></div><div><p className="text-sm font-semibold">Delivery PIN</p><p className="mt-1 text-xs leading-5 text-[#c6a18c]">Only share after the load is safely at your site.</p></div></div>{variant === "pin" || variant === "travelling" ? <div className="mt-4 flex items-center justify-between gap-3"><div className="rounded-xl bg-[#151311] px-4 py-2 font-mono text-[28px] font-bold tracking-[.18em] text-white">406532</div><button onClick={copyPin} className="flex items-center gap-1.5 text-xs font-semibold text-[#ffa366]">{copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}{copied ? "Copied" : "Copy PIN"}</button></div> : <div className="mt-4 flex items-center gap-2 rounded-xl bg-[#151311]/60 px-3 py-3 text-xs text-[#c6a18c]"><KeyRound className="size-4" /> PIN unlocks after loading is confirmed</div>}<button className="mt-3 text-xs font-medium text-[#ffa366] underline underline-offset-4">Need a new PIN?</button></section>
      <section className="grid gap-3 sm:grid-cols-2"><div className="rounded-[20px] border border-[#231e1a] bg-[#110e0c] p-4"><div className="flex items-center gap-2 text-xs font-semibold"><Package className="size-4 text-[#ff7716]" /> Supply confirmed</div><p className="mt-3 text-sm font-semibold capitalize">{material} · {data.quantity_m3} m³</p><p className="mt-1 text-xs text-[#8f8781]">Pickup: Driver arranges</p><p className="mt-1 flex items-start gap-1 text-xs text-[#8f8781]"><MapPin className="mt-0.5 size-3.5 shrink-0" />{data.delivery_address || "Harare delivery site"}</p></div><div className="rounded-[20px] border border-[#231e1a] bg-[#110e0c] p-4"><div className="flex items-center gap-2 text-xs font-semibold"><ImageIcon className="size-4 text-[#ff7716]" /> Delivery photos</div><div className="mt-3 flex items-center gap-2 text-sm font-semibold">{variant === "completed" ? <><CheckCircle2 className="size-4 text-[#7fe0a6]" /> Photo received</> : <><Clock3 className="size-4 text-[#8f8781]" /> Waiting for driver</>}</div><p className="mt-1 text-xs text-[#8f8781]">{driver} will add proof of delivery.</p></div></section>
      <details className="rounded-[20px] border border-[#231e1a] bg-[#110e0c] p-4"><summary className="flex cursor-pointer list-none items-center justify-between text-xs font-semibold uppercase tracking-wider text-[#8f8781]">Preview delivery states <ChevronRight className="size-4" /></summary><div className="mt-3 grid grid-cols-2 gap-2">{Object.entries(variants).map(([key, value]) => <button key={key} onClick={() => setVariant(key as Variant)} className={`rounded-xl border px-3 py-2 text-left text-xs ${variant === key ? "border-[#ff7716] bg-[#2a1407] text-[#ffa366]" : "border-[#342d28] text-[#a79e97]"}`}>{value.label}</button>)}</div></details>
    </div>
  </main>;
}
