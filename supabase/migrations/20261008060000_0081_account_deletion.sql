-- =============================================================================
-- 0081 — Complete, safe account deletion (audit F8 / M10)
-- =============================================================================
--
-- Problem (src/lib/account-deletion.ts, verified 08/10/2026): deletion
--   * ran even with money or work in flight (wallet balance, pending
--     withdrawal, paid escrow, active jobs, open disputes);
--   * ignored every error;
--   * missed six KYC document columns and the national ID number;
--   * left device/push tokens, GPS rows, truck plates, roles and chat media;
--   * did not revoke existing sessions.
--
-- Fix (DB part; the server function handles storage + auth):
--   account_deletion_blockers(uid) -> text[]  (empty = OK to delete)
--   anonymize_deleted_account(uid) -> jsonb   (atomic scrub; refuses while
--     any blocker exists; returns the storage paths to delete)
-- Financial and audit records (wallets, wallet_transactions, payments,
-- platform_ledger, escrow_refunds, wallet_audit_log, admin_audit_log) are
-- RETAINED, keyed to the now-anonymous user id, for reconciliation and legal
-- retention. Job rows, messages text, bids and ratings are retained because
-- they are also the counterparty's records; the person's name, contact
-- details, documents, location history and media are removed.
-- =============================================================================

create or replace function public.account_deletion_blockers(_uid uuid)
returns text[]
language sql
stable
security definer
set search_path to 'public'
as $$
  select array_remove(array[
    case when exists (select 1 from public.wallets where user_id = _uid and balance > 0) then 'wallet_balance_positive' end,
    case when exists (select 1 from public.wallets where user_id = _uid and balance < 0) then 'wallet_balance_owed' end,
    case when exists (select 1 from public.wallets where user_id = _uid and held > 0) then 'commission_held' end,
    case when exists (select 1 from public.wallet_withdrawal_requests where user_id = _uid and status = 'pending') then 'withdrawal_pending' end,
    case when exists (select 1 from public.wallet_topup_requests where user_id = _uid and status = 'pending') then 'topup_pending' end,
    case when exists (select 1 from public.jobs where (customer_id = _uid or driver_id = _uid)
                        and status in ('open', 'accepted', 'in_progress')) then 'active_jobs' end,
    case when exists (select 1 from public.payments where user_id = _uid
                        and (status in ('paid', 'refund_due')
                             or (status = 'initiated' and created_at > now() - interval '72 hours'))) then 'payment_in_progress' end,
    case when exists (select 1 from public.disputes where (raised_by = _uid or against = _uid)
                        and status in ('open', 'investigating')) then 'open_disputes' end
  ], null)
$$;
revoke all on function public.account_deletion_blockers(uuid) from public, anon;
grant execute on function public.account_deletion_blockers(uuid) to authenticated, service_role;

create or replace function public.anonymize_deleted_account(_uid uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _blockers text[] := public.account_deletion_blockers(_uid);
  _doc_paths text[];
  _media_paths text[];
begin
  if _uid is null or not exists (select 1 from public.profiles where id = _uid) then
    raise exception 'Account not found';
  end if;
  if array_length(_blockers, 1) is not null then
    raise exception 'ACCOUNT_DELETION_BLOCKED: %', array_to_string(_blockers, ',') using errcode = '22023';
  end if;

  select coalesce(array_agg(name), '{}') into _doc_paths
    from storage.objects where bucket_id = 'driver-docs' and (storage.foldername(name))[1] = _uid::text;

  select coalesce(array_agg(p), '{}') into _media_paths from (
    select image_url as p from public.messages where sender_id = _uid and image_url is not null
    union
    select audio_url from public.messages where sender_id = _uid and audio_url is not null
  ) m;

  update public.profiles
     set full_name = 'Deleted user', phone = null, email = null, avatar_url = null,
         restriction_reason = null,
         deleted_at = now(), status = 'banned'
   where id = _uid;

  update public.driver_profiles
     set national_id = null, nationality = null, national_id_url = null, selfie_url = null,
         license_url = null, operator_license_url = null, certificate_of_fitness_url = null,
         git_insurance_url = null, zinara_url = null, tipper_photo_url = null,
         tipper_photo_side_url = null, tipper_photo_back_url = null,
         withdrawal_pin_hash = null, verification_status = 'rejected',
         verification_notes = 'Account deleted by user', verified_at = null, reverify_due_at = null
   where user_id = _uid;

  update public.trucks set registration = 'DELETED-' || left(id::text, 8), photo_url = null where driver_id = _uid;
  update public.messages set image_url = null, audio_url = null where sender_id = _uid;

  delete from public.device_tokens       where user_id = _uid;
  delete from public.push_subscriptions  where user_id = _uid;
  delete from public.driver_availability where driver_id = _uid;
  delete from public.driver_locations    where driver_id = _uid;
  delete from public.user_roles          where user_id = _uid;

  insert into public.wallet_audit_log (user_id, actor_id, action, meta)
  values (_uid, _uid, 'account_deleted',
          jsonb_build_object('documents_removed', coalesce(array_length(_doc_paths, 1), 0),
                             'media_removed', coalesce(array_length(_media_paths, 1), 0)));

  return jsonb_build_object('driver_docs', to_jsonb(_doc_paths), 'chat_media', to_jsonb(_media_paths));
end $$;
revoke all on function public.anonymize_deleted_account(uuid) from public, anon, authenticated;
grant execute on function public.anonymize_deleted_account(uuid) to service_role;
