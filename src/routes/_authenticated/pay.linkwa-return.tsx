import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Notice } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { verifyLinkwaReturn } from "@/lib/payments/linkwa.functions";

// Linkwa SANDBOX return page. Linkwa adds ?short_url=&payment_reference= to the return address. This page never
// decides anything itself: it asks the server, which asks Linkwa directly for that payment's status
// (verifyLinkwaReturn). Off everywhere the sandbox is not allowed (the server answers "unavailable").

type Search = { short_url?: string; payment_reference?: string };

export const Route = createFileRoute("/_authenticated/pay/linkwa-return")({
  validateSearch: (search: Record<string, unknown>): Search => ({
    short_url: typeof search.short_url === "string" ? search.short_url : undefined,
    payment_reference:
      typeof search.payment_reference === "string" ? search.payment_reference : undefined,
  }),
  component: LinkwaReturnPage,
});

function LinkwaReturnPage() {
  const { short_url: shortUrl, payment_reference: paymentReference } = Route.useSearch();
  const ready = Boolean(shortUrl && paymentReference);
  const q = useQuery({
    queryKey: ["linkwa-return", shortUrl, paymentReference],
    enabled: ready,
    retry: false,
    queryFn: () =>
      verifyLinkwaReturn({
        data: { shortUrl: shortUrl as string, paymentReference: paymentReference as string },
      }),
  });

  const r = q.data;
  const jobId = r && r.ok ? r.jobId : null;
  return (
    <AppShell title="Payment">
      <div className="mx-auto max-w-md space-y-4 p-4">
        {!ready ? (
          <Notice tone="warning" title="Payment details missing">
            This page needs the payment details Linkwa adds when it sends you back. Open your job to
            see its payment status.
          </Notice>
        ) : q.isPending ? (
          <Notice title="Checking your payment">Asking Linkwa for the result…</Notice>
        ) : q.isError || !r || !r.ok ? (
          <Notice tone="danger" title="We could not confirm this payment yet">
            Nothing was charged twice. Try again in a minute, or open your job to check its status.
          </Notice>
        ) : r.state === "paid" ? (
          <Notice tone="success" title="Payment confirmed">
            Linkwa confirmed your payment. Your driver can now load.
          </Notice>
        ) : r.state === "pending" ? (
          <Notice title="Payment still processing">
            Linkwa has not finished this payment yet. Check again in a minute.
          </Notice>
        ) : r.state === "not_paid" ? (
          <Notice tone="warning" title="Payment not completed">
            This attempt did not go through and nothing was taken. You can try again from your job.
          </Notice>
        ) : (
          <Notice tone="warning" title="Payment under review">
            We received a result we need to check. Our team has been told; you do not need to pay
            again.
          </Notice>
        )}
        <div className="flex gap-2">
          {ready && (
            <Button variant="outline" onClick={() => q.refetch()} disabled={q.isFetching}>
              Check again
            </Button>
          )}
          <Button asChild>
            {jobId ? (
              <Link to="/jobs/$id" params={{ id: jobId }}>
                Open job
              </Link>
            ) : (
              <Link to="/jobs">My jobs</Link>
            )}
          </Button>
        </div>
      </div>
    </AppShell>
  );
}
