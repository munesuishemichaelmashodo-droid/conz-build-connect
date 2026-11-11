-- -----------------------------------------------------------------------------
-- 0135: optional mobilisation deposit stated in a driver's offer.
--
-- A deposit is OPTIONAL. An offer either has none (all deposit fields empty) or states: that a deposit is
-- required, the amount, the reason, and the cancellation / refund terms. The remaining balance is the offer
-- price minus the deposit (shown by the app, never stored twice).
-- The customer must accept the stated terms before selecting that driver (acknowledge_deposit_terms);
-- changing the terms after that resets the acceptance. accept_bid / accept_counter are unchanged: a
-- trigger refuses to mark such an offer accepted without the customer's acceptance.
--
-- ConZ does not hold, collect or guarantee this money. The deposit is agreed and paid directly between the
-- customer and the driver; it is separate from the materials payment, the transport balance and ConZ's
-- commission. Nothing here moves money. No DROP. Undo: supabase/rollbacks/20261103170000_0135_rollback.sql
-- -----------------------------------------------------------------------------

begin;

alter table public.bids add column if not exists deposit_required boolean not null default false;
alter table public.bids add column if not exists deposit_amount numeric(12, 2);
alter table public.bids add column if not exists deposit_reason text;
alter table public.bids add column if not exists deposit_terms text;
alter table public.bids add column if not exists deposit_terms_accepted_at timestamptz;

create or replace function public.tg_bids_deposit_rules()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare _client boolean := current_user in ('authenticated', 'anon');
begin
  if not new.deposit_required then
    new.deposit_amount := null; new.deposit_reason := null; new.deposit_terms := null;
    new.deposit_terms_accepted_at := null;
    return new;
  end if;

  if new.deposit_amount is null or new.deposit_amount <= 0 or new.deposit_amount > new.price then
    raise exception 'A deposit must be more than 0 and no more than the offer price.' using errcode = '22023';
  end if;
  if new.deposit_reason is null or length(btrim(new.deposit_reason)) < 5 or length(new.deposit_reason) > 300 then
    raise exception 'Say why a deposit is needed (5 to 300 characters).' using errcode = '22023';
  end if;
  if new.deposit_terms is null or length(btrim(new.deposit_terms)) < 10 or length(new.deposit_terms) > 600 then
    raise exception 'State the cancellation and refund terms for the deposit (10 to 600 characters).' using errcode = '22023';
  end if;

  if tg_op = 'INSERT' then
    new.deposit_terms_accepted_at := null;          -- only the customer can accept, through the function
    return new;
  end if;

  if _client and new.deposit_terms_accepted_at is distinct from old.deposit_terms_accepted_at then
    raise exception 'Only the customer can accept the deposit terms.' using errcode = '42501';
  end if;

  -- Any change to the terms (or the price they apply to) needs the customer's acceptance again.
  if new.status = 'pending'
     and (new.deposit_required is distinct from old.deposit_required
          or new.deposit_amount is distinct from old.deposit_amount
          or new.deposit_reason is distinct from old.deposit_reason
          or new.deposit_terms is distinct from old.deposit_terms
          or new.price is distinct from old.price)
     and new.deposit_terms_accepted_at is not distinct from old.deposit_terms_accepted_at then
    new.deposit_terms_accepted_at := null;
  end if;

  -- Selecting the driver needs the customer's acceptance of exactly these terms.
  if new.status = 'accepted' and old.status is distinct from 'accepted' and old.deposit_terms_accepted_at is null then
    raise exception 'The customer must accept the driver''s deposit terms before selecting this offer.' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.tg_bids_deposit_rules() from public, anon, authenticated;

drop trigger if exists trg_bids_deposit_rules on public.bids;
create trigger trg_bids_deposit_rules
  before insert or update on public.bids
  for each row execute function public.tg_bids_deposit_rules();

create or replace function public.acknowledge_deposit_terms(_bid_id uuid)
returns public.bids
language plpgsql
security definer
set search_path to 'public'
as $$
declare _b public.bids; _j public.jobs;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode = '28000'; end if;
  select * into _b from public.bids where id = _bid_id for update;
  if not found then raise exception 'Offer not found.' using errcode = '22023'; end if;
  select * into _j from public.jobs where id = _b.job_id;
  if _j.customer_id <> auth.uid() then raise exception 'Only the customer can accept these terms.' using errcode = '42501'; end if;
  if _b.status <> 'pending' or not _b.deposit_required then raise exception 'This offer has no deposit to accept.' using errcode = '22023'; end if;
  update public.bids set deposit_terms_accepted_at = now() where id = _bid_id returning * into _b;
  return _b;
end $$;
revoke all on function public.acknowledge_deposit_terms(uuid) from public, anon;
grant execute on function public.acknowledge_deposit_terms(uuid) to authenticated;

commit;
