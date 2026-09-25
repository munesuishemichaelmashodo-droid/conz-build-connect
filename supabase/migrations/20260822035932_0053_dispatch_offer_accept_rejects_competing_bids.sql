-- Recovered verbatim from live supabase_migrations.schema_migrations on
-- 2026-09-25 (was applied live without a committed file).
-- accept_dispatch_offer previously left any other pending bids on the
-- same job untouched after the job was assigned via a dispatch offer,
-- so rejected drivers' bids kept showing as "active" in bid-status
-- queries. Bring it in line with accept_bid()/accept_counter(), which
-- already reject every other pending bid atomically.
create or replace function public.accept_dispatch_offer(_offer_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  offer_row public.job_dispatch_offers%rowtype;
  job_row   public.jobs%rowtype;
  guard     jsonb;
begin
  select * into offer_row from public.job_dispatch_offers
    where id = _offer_id for update;
  if not found then raise exception 'Offer not found'; end if;
  if offer_row.driver_id <> auth.uid() then raise exception 'Not your offer'; end if;
  if offer_row.status <> 'pending' then raise exception 'Offer no longer available'; end if;

  if offer_row.expires_at < now() then
    update public.job_dispatch_offers
       set status = 'expired', responded_at = now() where id = _offer_id;
    raise exception 'Offer expired';
  end if;

  select * into job_row from public.jobs where id = offer_row.job_id for update;
  if job_row.status <> 'open' then raise exception 'Job no longer available'; end if;

  guard := public.driver_can_accept(job_row.id);
  if (guard->>'ok')::boolean is not true then
    raise exception 'Insufficient wallet balance: need $% commission, have $% available',
      guard->>'required', guard->>'available';
  end if;

  update public.jobs
     set driver_id = auth.uid(), status = 'accepted',
         final_price = coalesce(final_price, budget)
   where id = job_row.id;

  perform public.hold_job_commission(job_row.id);

  -- Reject every competing pending bid on this job, same as accept_bid()/
  -- accept_counter(), so bid-status queries can't show a rejected
  -- driver as still active. Their trg_notify_bid_status trigger fires
  -- the "job went to another driver" notification for us.
  update public.bids
     set status = 'rejected'
   where job_id = job_row.id and status = 'pending';

  update public.job_dispatch_offers
     set status = 'accepted', responded_at = now() where id = _offer_id;
  update public.job_dispatch_offers
     set status = 'superseded', responded_at = now()
   where job_id = job_row.id and id <> _offer_id and status = 'pending';

  return job_row.id;
end;
$function$;
