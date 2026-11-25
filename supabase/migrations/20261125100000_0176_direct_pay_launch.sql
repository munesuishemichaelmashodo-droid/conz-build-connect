-- -----------------------------------------------------------------------------
-- 0176: direct-payment launch (customer pays the driver; ConZ's 7% comes from the driver's commission credit).
--
-- 1. The free first job is retired for good (owner decision 09/11/2026). Until now tg_retire_free_first_job only
--    marked new drivers as "free job used" while the promotional-credit switch was on, so turning that switch off
--    would quietly give every new driver a commission-free first job again. It now always does, and any profile
--    still marked unused is marked used (production had none on 24/11; this is a no-op there).
--    hold_job_commission / settle_direct_pay_job / driver_can_accept_for are unchanged: their free branch can no
--    longer be reached.
--
-- 2. Evidence of a direct payment. ConZ does not handle a direct payment, so it cannot verify it. What it can keep
--    is the DRIVER's own confirmation that they received the money: method, amount, the provider's reference when
--    there is one (e.g. an EcoCash code) and when they confirmed. It is stored once (direct_payment_confirmations),
--    never edited or deleted, and is described everywhere as "confirmed by the driver", never as verified by ConZ.
--    A confirmed amount that differs from the agreed price is kept and flagged to admins; commission never changes
--    (it is 7% of jobs.final_price, reserved at acceptance and charged once at completion).
--    Readable by the job's customer, its driver and admins. Written only by driver_confirm_direct_payment().
--
-- No DROP, no DELETE. Undo: supabase/rollbacks/20261125100000_0176_rollback.sql.
-- Tests: supabase/tests/database/1100_direct_pay_launch.test.sql
-- -----------------------------------------------------------------------------

-- 1. Free first job: retired regardless of the promotional-credit switch -------------------------------------
create or replace function public.tg_retire_free_first_job()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  new.first_job_free_used := true;   -- 0176: always (was: only while promo_credit_enabled)
  return new;
end $$;
revoke all on function public.tg_retire_free_first_job() from public, anon, authenticated;

update public.driver_profiles set first_job_free_used = true where first_job_free_used is distinct from true;

-- 2. Driver's confirmation of a direct payment ---------------------------------------------------------------
create table if not exists public.direct_payment_confirmations (
  job_id         uuid primary key references public.jobs(id),
  driver_id      uuid not null,
  method         text not null check (method in ('cash', 'ecocash', 'onemoney', 'innbucks', 'bank_transfer', 'other')),
  amount         numeric(12, 2) not null check (amount > 0 and amount <= 100000),
  agreed_amount  numeric(12, 2) not null,
  reference      text check (reference is null or (length(reference) between 1 and 100 and reference !~ '[[:cntrl:]]')),
  confirmed_at   timestamptz not null default now()
);

create or replace function public.direct_payment_confirmations_immutable()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  raise exception 'A payment confirmation cannot be changed or deleted. Raise a dispute instead.' using errcode = '42501';
end $$;
revoke all on function public.direct_payment_confirmations_immutable() from public, anon, authenticated;
create or replace trigger trg_direct_payment_confirmations_immutable
  before update or delete on public.direct_payment_confirmations
  for each row execute function public.direct_payment_confirmations_immutable();

alter table public.direct_payment_confirmations enable row level security;
revoke all on public.direct_payment_confirmations from public, anon, authenticated;
grant select on public.direct_payment_confirmations to authenticated;
grant all on public.direct_payment_confirmations to service_role;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'direct_payment_confirmations'
                   and policyname = 'direct_payment_confirmations_parties_read') then
    create policy direct_payment_confirmations_parties_read on public.direct_payment_confirmations
      for select to authenticated
      using (
        driver_id = auth.uid()
        or exists (select 1 from public.jobs j where j.id = job_id and j.customer_id = auth.uid())
        or public.has_role(auth.uid(), 'admin'::public.app_role)
        or public.has_role(auth.uid(), 'super_admin'::public.app_role)
      );
  end if;
end $$;

-- The job's driver confirms they received the customer's payment. Once per job; repeating the same confirmation
-- returns it unchanged, a different one is refused (use a dispute).
create or replace function public.driver_confirm_direct_payment(_job_id uuid, _method text, _amount numeric,
                                                                 _reference text default null)
returns public.direct_payment_confirmations
language plpgsql security definer set search_path to 'public' as $$
declare _job public.jobs; _row public.direct_payment_confirmations; _ref text := nullif(btrim(coalesce(_reference, '')), '');
        _amt numeric := round(_amount, 2);
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select * into _job from public.jobs where id = _job_id for update;
  if not found or _job.driver_id is distinct from auth.uid() then
    raise exception 'Only the driver of this job can confirm its payment.' using errcode = '42501';
  end if;
  if _job.payment_method is distinct from 'direct' then
    raise exception 'This job was not paid directly to the driver.';
  end if;
  if _job.status not in ('accepted', 'in_progress', 'completed') then
    raise exception 'A payment can only be confirmed on an active or completed job.';
  end if;
  if _method is null or _method not in ('cash', 'ecocash', 'onemoney', 'innbucks', 'bank_transfer', 'other') then
    raise exception 'Choose how you were paid.';
  end if;
  if _amt is null or not public.is_valid_money(_amt) or _amt <= 0 then
    raise exception 'Enter the amount you received.';
  end if;
  if _ref is not null and (length(_ref) > 100 or _ref ~ '[[:cntrl:]]') then
    raise exception 'The payment reference is too long or has invalid characters.';
  end if;

  select * into _row from public.direct_payment_confirmations where job_id = _job_id;
  if found then
    if _row.method = _method and _row.amount = _amt and _row.reference is not distinct from _ref then
      return _row;                                      -- idempotent repeat
    end if;
    raise exception 'You already confirmed this payment. If something is wrong, raise a dispute.';
  end if;

  insert into public.direct_payment_confirmations (job_id, driver_id, method, amount, agreed_amount, reference)
  values (_job_id, auth.uid(), _method, _amt, coalesce(_job.final_price, _job.budget), _ref)
  returning * into _row;

  insert into public.notifications (user_id, type, title, body, job_id)
  values (_job.customer_id, 'payment_confirmed', 'Driver confirmed your payment',
          format('Your driver confirmed receiving $%s (%s). Con Z did not handle this payment.', _amt, replace(_method, '_', ' ')),
          _job_id);

  if _amt <> coalesce(_job.final_price, _job.budget) then
    insert into public.notifications (user_id, type, title, body, job_id)
    select distinct ur.user_id, 'payment_anomaly', 'Direct payment differs from the agreed price',
           format('Job %s: the driver confirmed receiving $%s; the agreed price is $%s. Commission stays 7%% of the agreed price.',
                  _job_id, _amt, coalesce(_job.final_price, _job.budget)),
           _job_id
      from public.user_roles ur where ur.role in ('admin', 'super_admin');
  end if;
  return _row;
end $$;
revoke all on function public.driver_confirm_direct_payment(uuid, text, numeric, text) from public, anon;
grant execute on function public.driver_confirm_direct_payment(uuid, text, numeric, text) to authenticated;
