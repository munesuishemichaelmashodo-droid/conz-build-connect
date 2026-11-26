-- -----------------------------------------------------------------------------
-- 0184: Stage 3 security, fraud prevention and trust (26/11/2026). Extends existing systems only.
--
-- Found (production, read-only, 26/11):
--   1. disputes: the RLS policy "Admins resolve disputes" lets any admin UPDATE a dispute row directly, and
--      authenticated still holds UPDATE/DELETE grants. The admin screen used it to mark "investigating" and to
--      REJECT a dispute (status, resolution, resolved_at), so a dispute could be closed with no audit-log entry,
--      no resolved_by, and no notice to either party. resolve_dispute (outcomes) is audited; rejection was not.
--   2. chat_flags and disputes: anon still holds SELECT, and authenticated holds INSERT/UPDATE/DELETE on chat_flags.
--      RLS blocked them (no matching policy), so this is defence in depth, not an open hole. chat_flags are written
--      only by tg_flag_contact_sharing (SECURITY DEFINER).
--   3. No place for a person to review weak fraud signals (shared phone numbers, the same customer and driver
--      completing many jobs together, a payment reference reused across jobs, flagged referrals).
--
-- Changes:
--   * admin_mark_dispute_investigating(_dispute_id) and admin_reject_dispute(_dispute_id, _reason): admin only,
--     never a party to the dispute, state checks, written reason for rejection, resolved_by/at, audit log, and both
--     parties notified of a rejection. Direct UPDATE/DELETE of disputes by clients is revoked (resolve_dispute,
--     escalate_overdue_disputes and these two functions are the only writers).
--   * Unneeded grants on disputes and chat_flags revoked.
--   * admin_trust_signals(): admin-only, read-only list of signals for HUMAN REVIEW. It changes nothing about any
--     account (no suspension, no block, no flag). Phone numbers are shown as the last 3 digits only; no national
--     ID, document or address is returned. Each viewing is written to the audit log.
-- No DROP, no DELETE. Undo: supabase/rollbacks/20261126160000_0184_rollback.sql.
-- -----------------------------------------------------------------------------

-- 1. Dispute actions --------------------------------------------------------------------------------------------
create or replace function public.admin_mark_dispute_investigating(_dispute_id uuid)
returns public.disputes
language plpgsql security definer set search_path to 'public' as $$
declare _d public.disputes;
begin
  if not (public.has_role(auth.uid(), 'admin'::public.app_role) or public.has_role(auth.uid(), 'super_admin'::public.app_role)) then
    raise exception 'Only admins can review disputes.' using errcode = '42501';
  end if;
  select * into _d from public.disputes where id = _dispute_id for update;
  if not found then raise exception 'Dispute not found'; end if;
  if auth.uid() in (_d.raised_by, _d.against) then
    raise exception 'You cannot review a dispute you are part of.' using errcode = '42501';
  end if;
  if _d.status <> 'open' then
    raise exception 'Only an open dispute can be marked as investigating (it is %).', _d.status using errcode = '22023';
  end if;
  update public.disputes set status = 'investigating' where id = _dispute_id returning * into _d;
  perform public.log_admin_action('dispute_investigating', jsonb_build_object('dispute_id', _dispute_id, 'job_id', _d.job_id),
                                  null, _dispute_id, _d.against);
  return _d;
end $$;
revoke all on function public.admin_mark_dispute_investigating(uuid) from public, anon;
grant execute on function public.admin_mark_dispute_investigating(uuid) to authenticated;

create or replace function public.admin_reject_dispute(_dispute_id uuid, _reason text)
returns public.disputes
language plpgsql security definer set search_path to 'public' as $$
declare _d public.disputes; _r text := nullif(btrim(coalesce(_reason, '')), '');
begin
  if not (public.has_role(auth.uid(), 'admin'::public.app_role) or public.has_role(auth.uid(), 'super_admin'::public.app_role)) then
    raise exception 'Only admins can decide disputes.' using errcode = '42501';
  end if;
  if _r is null or length(_r) < 5 then
    raise exception 'Give a reason (at least 5 characters). Both parties will see it.' using errcode = '22023';
  end if;
  select * into _d from public.disputes where id = _dispute_id for update;
  if not found then raise exception 'Dispute not found'; end if;
  if auth.uid() in (_d.raised_by, _d.against) then
    raise exception 'You cannot decide a dispute you are part of.' using errcode = '42501';
  end if;
  if _d.status not in ('open', 'investigating') then
    raise exception 'This dispute is already %.', _d.status using errcode = '22023';
  end if;
  update public.disputes
     set status = 'rejected', resolution = _r, resolved_at = now(), resolved_by = auth.uid()
   where id = _dispute_id returning * into _d;
  perform public.log_admin_action('dispute_rejected', jsonb_build_object('dispute_id', _dispute_id, 'job_id', _d.job_id),
                                  _r, _dispute_id, _d.against);
  insert into public.notifications (user_id, type, title, body, job_id)
  select u, 'dispute_resolved', 'Dispute closed without action', _r, _d.job_id
    from unnest(array[_d.raised_by, _d.against]) as u where u is not null;
  return _d;
end $$;
revoke all on function public.admin_reject_dispute(uuid, text) from public, anon;
grant execute on function public.admin_reject_dispute(uuid, text) to authenticated;

-- 2. Unneeded grants ------------------------------------------------------------------------------------------
revoke update, delete, truncate on public.disputes from anon, authenticated;
revoke select on public.disputes from anon;
revoke insert, update, delete, truncate on public.chat_flags from anon, authenticated;
revoke select on public.chat_flags from anon;

-- 3. Signals for human review (never automatic action) ---------------------------------------------------------
create or replace function public.admin_trust_signals()
returns table (signal text, detail text, user_ids uuid[], job_ids uuid[], seen integer)
language plpgsql security definer set search_path to 'public' as $$
begin
  if not (public.has_role(auth.uid(), 'admin'::public.app_role) or public.has_role(auth.uid(), 'super_admin'::public.app_role)) then
    raise exception 'Admins only.' using errcode = '42501';
  end if;
  perform public.log_admin_action('trust_signals_viewed', '{}'::jsonb, null, null, null);

  return query
  -- The same phone number on more than one account (last 9 digits compared; shown as the last 3 only).
  with phones as (
    select id, right(regexp_replace(phone, '\D', '', 'g'), 9) as p from public.profiles
     where phone is not null and length(regexp_replace(phone, '\D', '', 'g')) >= 7
  )
  select 'shared_phone'::text,
         format('%s accounts use the same phone number (ending %s)', count(*), right(p, 3)),
         array_agg(id order by id), null::uuid[], count(*)::int
    from phones group by p having count(*) > 1

  union all
  -- Completed jobs where the customer and the driver share a phone number.
  select 'customer_driver_same_phone',
         'Completed job between a customer and a driver with the same phone number',
         array[j.customer_id, j.driver_id], array[j.id], 1
    from public.jobs j
    join public.profiles c on c.id = j.customer_id
    join public.profiles d on d.id = j.driver_id
   where j.status = 'completed' and c.phone is not null and d.phone is not null
     and right(regexp_replace(c.phone, '\D', '', 'g'), 9) = right(regexp_replace(d.phone, '\D', '', 'g'), 9)

  union all
  -- The same customer and driver completing 4 or more jobs together in 30 days.
  select 'repeated_pair_30_days',
         format('%s completed jobs between the same customer and driver in the last 30 days', count(*)),
         array[j.customer_id, j.driver_id], array_agg(j.id order by j.completed_at), count(*)::int
    from public.jobs j
   where j.status = 'completed' and j.completed_at > now() - interval '30 days' and j.driver_id is not null
   group by j.customer_id, j.driver_id having count(*) >= 4

  union all
  -- One payment reference recorded on more than one job (statements are the parties' own words).
  select 'payment_reference_reused',
         format('The same payment reference was recorded on %s different jobs', count(distinct s.job_id)),
         null::uuid[], array_agg(distinct s.job_id), count(distinct s.job_id)::int
    from (select job_id, nullif(upper(btrim(customer_reference)), '') as ref from public.direct_payment_stages
          union all
          select job_id, nullif(upper(btrim(driver_reference)), '') from public.direct_payment_stages) s
   where s.ref is not null and length(s.ref) >= 4
   group by s.ref having count(distinct s.job_id) > 1

  union all
  -- Referrals already flagged at sign-up and not yet decided.
  select 'flagged_referral', coalesce(r.fraud_reason, 'Flagged for review'),
         array[r.referrer_id, r.referred_id], null::uuid[], 1
    from public.referrals r
   where coalesce(r.fraud_flag, false) and r.reward_status not in ('rejected', 'released');
end $$;
revoke all on function public.admin_trust_signals() from public, anon;
grant execute on function public.admin_trust_signals() to authenticated;
