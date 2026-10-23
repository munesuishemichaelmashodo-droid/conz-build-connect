import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Loader2, MapPin } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { MaterialCategory } from "@/lib/domain";
import { DeliveryTrackingScreen } from "@/components/DeliveryTrackingScreen";

export const Route = createFileRoute("/track/$token")({
  ssr: false,
  component: PublicTrackPage,
});

type TrackPayload = {
  status: string;
  material: MaterialCategory;
  custom_material: string | null;
  quantity_m3: number;
  delivery_address: string | null;
  delivery_lat: number | null;
  delivery_lng: number | null;
  preferred_date: string | null;
  driver_name: string | null;
  live: { lat: number; lng: number; updated_at: string } | null;
};

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-[#010101]">{children}</div>;
}

function PublicTrackPage() {
  const { token } = Route.useParams();
  const { data, isLoading } = useQuery({
    queryKey: ["public-track", token],
    refetchInterval: 15000,
    retry: 1,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_public_tracking", { _token: token });
      if (error) throw error;
      return (data ?? null) as TrackPayload | null;
    },
  });

  if (isLoading) return <Shell><div className="flex min-h-screen items-center justify-center gap-2 text-sm text-[#a79e97]"><Loader2 className="size-4 animate-spin" /> Loading tracking…</div></Shell>;
  if (!data) return <Shell><div className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-3 px-6 text-center text-[#a79e97]"><MapPin className="size-7 text-[#ff7716]" /><h1 className="font-display text-2xl font-semibold text-white">Tracking link not found</h1><p className="text-sm">This tracking link is invalid or the job was removed.</p></div></Shell>;

  return <DeliveryTrackingScreen data={data} />;
}
