import { createFileRoute, Link } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { EmptyState } from "@/components/ui-bits";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Briefcase, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { JobCard } from "./home";

export const Route = createFileRoute("/_authenticated/jobs/")({
  component: JobsPage,
});

function JobsPage() {
  const { userId, is } = useAuth();
  const isDriver = is("driver");
  const isCustomer = is("customer");

  const { data: jobs, isLoading } = useQuery({
    queryKey: ["jobs-list", userId, isDriver, isCustomer],
    enabled: !!userId,
    refetchInterval: 4000,
    queryFn: async () => {
      let q = supabase.from("jobs").select("*").order("created_at", { ascending: false });
      if (isCustomer && !isDriver) q = q.eq("customer_id", userId!);
      else if (isDriver && !isCustomer)
        q = q.or(`and(status.eq.open,expires_at.gt.${new Date().toISOString()}),driver_id.eq.${userId}`);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
  });


  return (
    <AppShell title="Jobs" action={isCustomer ? (
      <Button asChild size="sm" className="h-8"><Link to="/jobs/new"><Plus className="w-4 h-4 mr-1" />New</Link></Button>
    ) : undefined}>
      {isLoading ? (
        <div className="text-center text-muted-foreground py-10">Loading…</div>
      ) : (jobs ?? []).length === 0 ? (
        <EmptyState icon={Briefcase} title="No jobs yet" hint={isCustomer ? "Post your first delivery request." : "Check back soon for open requests."} />
      ) : (
        <div className="space-y-2">{jobs!.map((j) => <JobCard key={j.id} j={j} />)}</div>
      )}
    </AppShell>
  );
}
