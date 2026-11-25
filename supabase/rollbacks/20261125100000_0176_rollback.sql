-- Undo 0176. Restores the 0134 trigger body (free first job retired only while promo credit is on) and removes the
-- direct-payment confirmation function. The confirmations table is kept with its rows (evidence is never deleted);
-- drop it by hand only if it is empty. Profiles marked "free job used" by 0176 are not reverted.
create or replace function public.tg_retire_free_first_job()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if coalesce((select (value #>> '{}')::boolean from public.system_settings where key = 'promo_credit_enabled'), false) then
    new.first_job_free_used := true;
  end if;
  return new;
end $$;
revoke all on function public.tg_retire_free_first_job() from public, anon, authenticated;

drop function if exists public.driver_confirm_direct_payment(uuid, text, numeric, text);
