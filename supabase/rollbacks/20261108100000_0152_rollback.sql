-- Undo 0152. Contains DROP: run it in the Supabase SQL editor (the MCP tool hangs on DROP).
-- Restores the 0114 body of tg_truck_change_needs_review, removes the card function and the declared truck facts.
drop function if exists public.offer_bidder_cards(uuid);

create or replace function public.tg_truck_change_needs_review()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  _uid uuid := auth.uid();
  _what text;
begin
  if _uid is null then return new; end if;
  if public.has_role(_uid, 'admin'::public.app_role) or public.has_role(_uid, 'super_admin'::public.app_role) then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.registration is not distinct from old.registration
       and new.capacity_m3 is not distinct from old.capacity_m3
       and new.photo_url is not distinct from old.photo_url
       and new.driver_id is not distinct from old.driver_id then
      return new;
    end if;
    _what := 'Truck details changed';
  else
    _what := 'New truck added';
  end if;

  update public.driver_profiles
     set verification_status = 'pending',
         verification_notes = _what || ' (' || coalesce(new.registration, 'no registration')
                              || '). Con Z needs to check it before you can take more jobs.'
   where user_id = new.driver_id
     and verification_status = 'verified';

  if found then
    update public.bids set status = 'withdrawn'
     where driver_id = new.driver_id and status = 'pending';
    begin
      insert into public.notifications (user_id, type, title, body)
      select distinct ur.user_id, 'truck_review', 'Truck needs review',
             _what || ' (' || coalesce(new.registration, 'no registration') || '). The driver is back in review.'
        from public.user_roles ur where ur.role in ('admin', 'super_admin');
    exception when others then
      raise warning 'truck review alert failed: %', sqlerrm;
    end;
  end if;
  return new;
end $$;
revoke all on function public.tg_truck_change_needs_review() from public, anon, authenticated;

alter table public.trucks drop column if exists colour;
alter table public.trucks drop column if exists model;
alter table public.trucks drop column if exists make;
alter table public.trucks drop column if exists body_type;
