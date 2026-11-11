import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { LogoLockup } from "@/components/ds";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/open-jobs")({
  ssr: false,
  component: OpenJobsPreview,
});

interface Preview {
  material: string;
  custom_material: string | null;
  quantity_m3: number | null;
  budget: number | null;
  area: string | null;
  posted_at: string;
  preferred_date: string | null;
}

type Rpc = (
  f: string,
  a: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

/** Real open requests, area only. A driver signs in (and must be verified) to see more and to send an offer. */
function OpenJobsPreview() {
  const { data, isLoading } = useQuery({
    queryKey: ["public-open-job-previews"],
    queryFn: async (): Promise<Preview[]> => {
      const { data: rows } = await (supabase.rpc as unknown as Rpc)("public_open_job_previews", {
        _limit: 12,
      });
      return (rows ?? []) as Preview[];
    },
  });
  const name = (p: Preview) => (p.custom_material || p.material).replace(/_/g, " ");

  return (
    <div className="cz-screen min-h-[100dvh] w-full bg-cz-bg text-cz-text">
      <div className="mx-auto w-full max-w-[520px] px-4 pb-10">
        <header className="flex items-center justify-between gap-2 py-3">
          <LogoLockup />
          <Link
            to="/auth"
            search={{ mode: "login" } as never}
            className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold hover:bg-cz-surface-2"
          >
            Log in
          </Link>
        </header>
        <main className="space-y-4 pt-2">
          <h1 className="cz-display text-[26px] font-bold leading-tight">Open delivery requests</h1>
          <p className="text-sm text-cz-muted">
            These are real requests waiting for offers. Only the material, size, price and area are
            shown. The exact address and the customer's details are shared once the customer selects
            you.
          </p>
          {isLoading ? (
            <p className="text-sm text-cz-muted">Loading…</p>
          ) : (data ?? []).length === 0 ? (
            <p className="rounded-xl border border-cz-border bg-cz-surface p-4 text-sm">
              No open requests right now. Register as a driver and we will tell you when jobs near
              you are posted.
            </p>
          ) : (
            <ul className="space-y-2">
              {(data ?? []).map((p, i) => (
                <li key={i} className="rounded-xl border border-cz-border bg-cz-surface p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold capitalize">
                      {name(p)}
                      {p.quantity_m3 ? ` · ${Number(p.quantity_m3)} m³` : ""}
                    </p>
                    {p.budget != null && (
                      <p className="text-sm font-bold">${Number(p.budget).toFixed(2)}</p>
                    )}
                  </div>
                  <p className="text-xs text-cz-muted">
                    {p.area ?? "Area shared once you are selected"}
                  </p>
                  <p className="mt-1 text-xs text-cz-muted">
                    Posted{" "}
                    {new Date(p.posted_at).toLocaleDateString("en-GB", {
                      timeZone: "Africa/Harare",
                    })}
                    {p.preferred_date ? ` · wanted by ${p.preferred_date}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <div className="space-y-2 pt-2">
            <Link
              to="/auth"
              search={{ mode: "register", role: "driver" } as never}
              className="flex min-h-12 items-center justify-center rounded-xl bg-cz-text px-4 text-[15px] font-semibold text-cz-bg"
            >
              Sign up as a driver to send offers
            </Link>
            <p className="text-center text-xs text-cz-muted">
              Offers are free. You need to be verified by Con Z before you can send one.
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}
