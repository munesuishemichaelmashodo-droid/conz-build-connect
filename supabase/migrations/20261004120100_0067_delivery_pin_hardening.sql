-- 0067 — Escrow delivery PIN hardening (audit C1).
--
-- Security reason: the escrow delivery PIN lived in plaintext on jobs.delivery_pin,
-- which the assigned driver can SELECT (Jobs visibility policy + table SELECT grant).
-- A driver could read the customer's code and release the escrowed funds to
-- themselves without the customer confirming delivery; the 6-digit PIN was also
-- generated with random() and had no attempt limit (brute-forceable).
--
-- Fix: the real code moves to public.job_delivery_pins, readable ONLY by the
-- job's customer (RLS) and never by the driver. jobs.delivery_pin is kept (so
-- select('*') and generated types are unaffected) but is always NULL now. The
-- code is generated with a CSPRNG (gen_random_bytes) and driver_confirm_delivery_pin
-- enforces a 5-attempt lockout and stays idempotent on an already-completed job.
--
-- Non-destructive: existing PINs are migrated into the new table before the
-- column is nulled. Safe to replay.

create table if not exists public.job_delivery_pins (
  job_id       uuid primary key references public.jobs(id) on delete cascade,
  pin          text not null,
  attempts     int not null default 0,
  locked_until timestamptz,
  created_at   timestamptz not null default now()
);

alter table public.job_delivery_pins enable row level security;

-- Only the job's customer may read the code (to read it out to the driver on
-- arrival). No client may write it — the generation trigger and confirm RPC
-- (SECURITY DEFINER, run as owner) are the only writers.
drop policy if exists "customer reads own delivery pin" on public.job_delivery_pins;
create policy "customer reads own delivery pin" on public.job_delivery_pins
  for select to authenticated
  using (exists (select 1 from public.jobs j
                 where j.id = job_delivery_pins.job_id and j.customer_id = auth.uid()));

revoke all on public.job_delivery_pins from anon, authenticated;
grant select on public.job_delivery_pins to authenticated;

-- Generation: on the escrow job becoming 'accepted', create a CSPRNG code in
-- the new table (once) and keep jobs.delivery_pin NULL.
create or replace function public.tg_generate_delivery_pin()
returns trigger language plpgsql security definer set search_path to 'public','extensions' as $fn$
declare _pin text;
begin
  if new.payment_method = 'escrow' and new.status = 'accepted'
     and (old.status is distinct from 'accepted') then
    new.delivery_pin := null;
    if not exists (select 1 from public.job_delivery_pins where job_id = new.id) then
      _pin := lpad(((('x' || encode(gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text, 6, '0');
      insert into public.job_delivery_pins(job_id, pin) values (new.id, _pin);
    end if;
  end if;
  return new;
end $fn$;

-- Customer-only read RPC (keeps the table shape private; mirrors the RLS).
create or replace function public.get_my_delivery_pin(_job_id uuid)
returns text language sql stable security definer set search_path to 'public' as $fn$
  select p.pin
  from public.job_delivery_pins p
  join public.jobs j on j.id = p.job_id
  where p.job_id = _job_id and j.customer_id = auth.uid();
$fn$;
revoke execute on function public.get_my_delivery_pin(uuid) from public, anon;
grant execute on function public.get_my_delivery_pin(uuid) to authenticated;

-- Confirm: driver submits the code; attempts are limited and the release is
-- idempotent (already-completed job returns without re-releasing).
create or replace function public.driver_confirm_delivery_pin(_job_id uuid, _pin text)
returns public.jobs language plpgsql security definer set search_path to 'public','extensions' as $fn$
declare _job public.jobs; _rec public.job_delivery_pins;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select * into _job from public.jobs where id = _job_id for update;
  if not found then raise exception 'Job not found'; end if;
  if _job.driver_id <> auth.uid() then raise exception 'Not your job'; end if;
  if _job.payment_method <> 'escrow' then raise exception 'This job does not use delivery PIN confirmation'; end if;
  if _job.status = 'completed' then return _job; end if;                 -- idempotent
  if _job.status not in ('accepted','in_progress') then raise exception 'Job not in progress'; end if;
  if _job.delivery_photo_url is null then raise exception 'Upload the delivery photo first'; end if;

  select * into _rec from public.job_delivery_pins where job_id = _job_id for update;
  if not found then raise exception 'No delivery code has been generated for this job yet'; end if;
  if _rec.locked_until is not null and _rec.locked_until > now() then
    raise exception 'Too many incorrect codes. Try again later.';
  end if;

  if trim(_pin) <> _rec.pin then
    update public.job_delivery_pins
       set attempts = attempts + 1,
           locked_until = case when attempts + 1 >= 5 then now() + interval '15 minutes' else locked_until end
     where job_id = _job_id;
    raise exception 'Incorrect code — ask the customer for the code shown in their app';
  end if;

  update public.job_delivery_pins set attempts = 0, locked_until = null where job_id = _job_id;
  return public.release_escrow_and_complete(_job_id, auth.uid());
end $fn$;
revoke execute on function public.driver_confirm_delivery_pin(uuid, text) from public, anon;
grant execute on function public.driver_confirm_delivery_pin(uuid, text) to authenticated;

-- Migrate any existing plaintext PINs into the new table, then null the column.
insert into public.job_delivery_pins(job_id, pin)
select id, delivery_pin from public.jobs
where delivery_pin is not null and payment_method = 'escrow'
on conflict (job_id) do nothing;

update public.jobs set delivery_pin = null where delivery_pin is not null;
