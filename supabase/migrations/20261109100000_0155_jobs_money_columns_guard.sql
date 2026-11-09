-- 0155: block direct client writes to money and assignment columns of public.jobs, for every client role including admins.
--
-- Audit findings (docs/marketplace/CONZ-MARKETPLACE-UPGRADE-AUDIT.md):
--   M1  jobs_guard_direct_write lets any admin return early, so an admin session could PATCH status = 'completed',
--       final_price, held_commission or commission straight on the table: no step-up, no audit row, no settlement.
--   H1  held_commission_promo (migration 0134, not live) is not in the guard, so a driver or customer could write it.
--
-- The app never updates these columns from the browser (every legitimate change happens inside a SECURITY DEFINER
-- function or as the service role, both of which run as a role other than authenticated/anon and are not affected).
-- Columns are compared through to_jsonb so the guard works whether or not 0134's column exists.
-- Additive: one function, one trigger (CREATE OR REPLACE, no DROP). Undo: supabase/rollbacks/20261109100000_0155_rollback.sql.

create or replace function public.tg_jobs_money_columns_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  _col text;
  _old jsonb;
  _new jsonb;
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  _old := to_jsonb(old);
  _new := to_jsonb(new);
  foreach _col in array array['status', 'commission', 'final_price', 'budget', 'held_commission', 'held_commission_promo',
                              'payment_method', 'driver_id', 'customer_id', 'accepted_bid_id', 'completed_at',
                              'delivery_pin', 'tracking_token', 'delivered_quantity_m3',
                              'cancelled_at', 'cancelled_by', 'cancellation_stage', 'cancellation_reason',
                              'pickup_photo_taken_at', 'delivery_photo_taken_at'] loop
    if _new -> _col is distinct from _old -> _col then
      raise exception 'This field can only be changed through the app''s job actions (accept / complete / cancel).'
        using errcode = '42501';
    end if;
  end loop;
  return new;
end $$;
revoke all on function public.tg_jobs_money_columns_guard() from public, anon, authenticated;

create or replace trigger trg_jobs_money_columns_guard
  before update on public.jobs
  for each row execute function public.tg_jobs_money_columns_guard();
