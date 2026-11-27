-- -----------------------------------------------------------------------------
-- 0189: the $20 promotional allowance covers the FIRST completed job only (owner decision, 27/11/2026).
--
-- Reuses 0134 unchanged where it already matches the decision: one grant per driver; non-cash, non-withdrawable,
-- non-transferable; reserved first (before real Commission Credit) when a job is accepted; returned to the promo
-- bucket, never to cash, when the job is cancelled.
--
-- Changes:
--   * On a driver's first completed job after this migration, whatever promotional allowance is still unused expires
--     (new ledger line kind 'expire', at most one per driver). Commission below $20: only the actual commission was
--     reserved from the allowance, the rest expires. Commission above $20: the full $20 was reserved and real
--     Commission Credit paid the rest (0134's existing order), nothing is left to expire.
--   * A new grant is given only to a driver with no completed job as a driver (the allowance is for a first job).
--   * Cancelled or unsuccessful jobs never expire or use it (0134 releases the reservation back to the allowance).
--   * Existing grants and balances are not touched by this file. The outstanding historical grant stays available
--     until that driver's next completed job.
-- No DROP of data. The one DROP CONSTRAINT widens the ledger's kind check in the same ALTER (reviewed exception).
-- Settings are not changed (promo_credit_enabled stays as it is). Recovery (forward-safe):
-- supabase/rollbacks/20261127100000_0189_rollback.sql.
-- -----------------------------------------------------------------------------

-- 1. Ledger: an 'expire' line (negative, tied to the completed job, once per driver) ---------------------------------
alter table public.promo_credit_ledger
  drop constraint if exists promo_credit_ledger_kind_check,
  add constraint promo_credit_ledger_kind_check check (kind in ('grant', 'reserve', 'release', 'expire')),
  add constraint promo_credit_ledger_expire_shape check (kind <> 'expire' or (amount < 0 and job_id is not null));
create unique index if not exists promo_one_expiry_per_driver on public.promo_credit_ledger (user_id) where kind = 'expire';

-- 2. Expire the unused allowance on the first completed job --------------------------------------------------------
create or replace function public.tg_expire_promo_after_first_completion()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare _left numeric;
begin
  if new.driver_id is null or new.status <> 'completed' or old.status = 'completed' then return null; end if;
  if not exists (select 1 from public.promo_credit_ledger where user_id = new.driver_id and kind = 'grant') then return null; end if;
  if exists (select 1 from public.promo_credit_ledger where user_id = new.driver_id and kind = 'expire') then return null; end if;
  select promo_balance into _left from public.wallets where user_id = new.driver_id for update;
  if coalesce(_left, 0) > 0 then
    insert into public.promo_credit_ledger (user_id, amount, kind, job_id, note)
    values (new.driver_id, -_left, 'expire', new.id, 'Unused promotional allowance expired after the first completed job');
    update public.wallets set promo_balance = 0, updated_at = now() where user_id = new.driver_id;
    begin
      insert into public.notifications (user_id, type, title, body, job_id)
      values (new.driver_id, 'promo_credit', 'Promotional allowance used',
              format('Your first job is complete. The promotional allowance covered its commission; the unused $%s has now expired.', _left),
              new.id);
    exception when others then raise warning 'promo expiry notice failed: %', sqlerrm;
    end;
  end if;
  return null;
exception when unique_violation then
  return null;   -- another transaction expired it first
end $$;
revoke all on function public.tg_expire_promo_after_first_completion() from public, anon, authenticated;
create or replace trigger trg_expire_promo_after_first_completion
  after update of status on public.jobs
  for each row execute function public.tg_expire_promo_after_first_completion();

-- 3. Grants only for drivers who have not completed a job ----------------------------------------------------------
create or replace function public.grant_promo_credit(_driver uuid, _by uuid default null)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare _on boolean; _amt numeric;
begin
  select coalesce((value #>> '{}')::boolean, false) into _on from public.system_settings where key = 'promo_credit_enabled';
  select coalesce((value #>> '{}')::numeric, 0) into _amt from public.system_settings where key = 'promo_credit_amount';
  if not coalesce(_on, false) or coalesce(_amt, 0) <= 0 or _amt > 1000 then return false; end if;
  if exists (select 1 from public.promo_credit_ledger where user_id = _driver and kind = 'grant') then return false; end if;
  -- (0189) the allowance is for a first job: a driver who has already completed one does not get it
  if exists (select 1 from public.jobs j where j.driver_id = _driver and j.status = 'completed') then return false; end if;
  insert into public.wallets (user_id, balance) values (_driver, 0) on conflict (user_id) do nothing;
  insert into public.promo_credit_ledger (user_id, amount, kind, note, created_by)
  values (_driver, round(_amt, 2), 'grant', 'One-time promotional allowance for the first completed job', _by);
  update public.wallets set promo_balance = promo_balance + round(_amt, 2), updated_at = now() where user_id = _driver;
  insert into public.notifications (user_id, type, title, body)
  values (_driver, 'promo_credit', 'Promotional allowance added',
          format('You have a $%s promotional allowance for the Con Z commission on your first completed job. Anything it does not use then expires. It is not cash and cannot be withdrawn.', round(_amt, 2)));
  return true;
exception when unique_violation then
  return false;
end $$;
revoke all on function public.grant_promo_credit(uuid, uuid) from public, anon, authenticated;
grant execute on function public.grant_promo_credit(uuid, uuid) to service_role;
