-- Undo 0117: restores tg_guard_bid_insert and accept_bid exactly as in production on
-- 26/10/2026 (read live with pg_get_functiondef). No DROP.
begin;

CREATE OR REPLACE FUNCTION public.tg_guard_bid_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _job public.jobs;
begin
  select * into _job from public.jobs where id = new.job_id for share;

  if not found then
    raise exception 'Job not found' using errcode = '42501';
  end if;


  if _job.status <> 'open' then
    raise exception 'This job has already been assigned to another driver.' using errcode = '42501';
  end if;

  if _job.driver_id is not null then
    raise exception 'This job has already been assigned to another driver.' using errcode = '42501';
  end if;

  if _job.expires_at is not null and _job.expires_at < now() then
    raise exception 'The bidding window for this job has expired.' using errcode = '42501';
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.accept_bid(_bid_id uuid)
 RETURNS jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  _bid   public.bids;
  _job   public.jobs;
  _guard jsonb;
  _loc   public.material_supply_locations;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;

  select * into _bid from public.bids where id = _bid_id for update;
  if not found then raise exception 'Bid not found'; end if;

  select * into _job from public.jobs where id = _bid.job_id for update;
  if not found then raise exception 'Job not found'; end if;

  if _job.customer_id <> auth.uid() then raise exception 'Not your job'; end if;
  if _job.status <> 'open' then raise exception 'Job not open'; end if;
  if _bid.status <> 'pending' then raise exception 'Bid no longer available'; end if;


  -- (0109) An offer past its expiry can no longer be accepted, whatever the
  -- trigger does. Checked after the row locks, against the live database clock.
  if _bid.expires_at is not null and _bid.expires_at < clock_timestamp() then
    raise exception 'This offer has expired. Ask the driver to send it again.'
      using errcode = '42501';
  end if;

  -- F1: never let an invalid price become the job's final price.
  if not public.is_valid_money(_bid.price) then
    raise exception 'This offer has an invalid price and cannot be accepted.';
  end if;

  -- (0101) No inventory reservation: supplier stock is advisory and is neither checked nor changed here.

  update public.bids set status = 'accepted' where id = _bid_id;
  update public.bids set status = 'rejected'
   where job_id = _job.id and id <> _bid_id and status = 'pending';

  update public.jobs
     set status = 'accepted', driver_id = _bid.driver_id,
         accepted_bid_id = _bid_id, final_price = _bid.price
   where id = _job.id
  returning * into _job;

  _guard := public.driver_can_accept_for(_job.id, _bid.driver_id);
  if (_guard->>'ok')::boolean is not true then
    raise exception 'Driver has insufficient wallet balance: needs $%, has $% available',
      _guard->>'required', _guard->>'available';
  end if;

  perform public.hold_job_commission(_job.id);

  update public.job_dispatch_offers
     set status = 'superseded', responded_at = now()
   where job_id = _job.id and status = 'pending';

  return _job;
end $function$;

commit;
