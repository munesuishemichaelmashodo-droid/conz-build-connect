-- =============================================================================
-- 0075 — Financial request immutability (audit F4)
-- =============================================================================
--
-- Problem (verified live 07/10/2026): policies wd_owner_cancel and
-- topup_owner_cancel let the owner UPDATE *every* column of their pending
-- request (the policy only constrained status). There was no guard trigger.
--   * A withdrawal that passed the PIN / balance checks in request_withdrawal()
--     could then have its destination (payout number) and amount rewritten —
--     including by someone holding a stolen session but not the PIN.
--   * A manual top-up request's amount / reference could be changed after an
--     admin had checked the proof of payment.
--   * Policies wd_admin_update / topup_super_admin_update let admins flip a
--     request to 'approved' directly, bypassing the RPCs that actually move
--     the money (so the record and the wallet could disagree).
--
-- Fix: one guard trigger for both tables, enforced for EVERY role:
--   * user_id, amount, method, destination / reference, note, created_at and
--     id are immutable after insert.
--   * status: pending -> cancelled | approved | rejected only; decided
--     requests are final.
--   * Client roles (authenticated / anon) may make exactly one change: the
--     owner cancelling their own pending request. Everything else goes
--     through the SECURITY DEFINER RPCs (request_*, cancel_*, admin_approve_*,
--     admin_reject_*), which run as the table owner.
--   * Admin direct-UPDATE policies dropped; client DELETE/TRUNCATE revoked.
-- =============================================================================

create or replace function public.financial_request_guard()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare _is_client boolean := current_user in ('authenticated', 'anon');
begin
  if new.id is distinct from old.id
     or new.user_id    is distinct from old.user_id
     or new.amount     is distinct from old.amount
     or new.method     is distinct from old.method
     or new.note       is distinct from old.note
     or new.created_at is distinct from old.created_at
  then
    raise exception 'A submitted request cannot be changed. Cancel it and submit a new one.' using errcode = '42501';
  end if;

  if tg_table_name = 'wallet_withdrawal_requests' then
    if new.destination is distinct from old.destination then
      raise exception 'A submitted withdrawal''s destination cannot be changed. Cancel it and submit a new one.' using errcode = '42501';
    end if;
  elsif tg_table_name = 'wallet_topup_requests' then
    if new.reference is distinct from old.reference then
      raise exception 'A submitted top-up''s reference cannot be changed. Cancel it and submit a new one.' using errcode = '42501';
    end if;
  end if;

  if old.status <> 'pending' then
    raise exception 'This request has already been %.', old.status using errcode = '42501';
  end if;
  if new.status not in ('pending', 'cancelled', 'approved', 'rejected') then
    raise exception 'Invalid request status %', new.status using errcode = '42501';
  end if;

  if _is_client then
    -- The only change a client may make: the owner cancels their own request.
    if not (new.status = 'cancelled'
            and old.user_id = auth.uid()
            and new.decided_by is not distinct from old.decided_by
            and new.reject_reason is not distinct from old.reject_reason) then
      raise exception 'Only the owner can cancel a pending request; approvals go through the admin tools.' using errcode = '42501';
    end if;
  end if;

  return new;
end $$;

drop trigger if exists trg_withdrawal_request_guard on public.wallet_withdrawal_requests;
create trigger trg_withdrawal_request_guard
  before update on public.wallet_withdrawal_requests
  for each row execute function public.financial_request_guard();

drop trigger if exists trg_topup_request_guard on public.wallet_topup_requests;
create trigger trg_topup_request_guard
  before update on public.wallet_topup_requests
  for each row execute function public.financial_request_guard();

-- Admin approvals must go through admin_approve_* / admin_reject_*, which
-- move the money and write the ledger + audit log in the same transaction.
drop policy if exists wd_admin_update on public.wallet_withdrawal_requests;
drop policy if exists topup_super_admin_update on public.wallet_topup_requests;

-- Client INSERT was already revoked (0066); drop the dead policies too.
drop policy if exists wd_owner_insert on public.wallet_withdrawal_requests;
drop policy if exists topup_owner_insert on public.wallet_topup_requests;

revoke delete, truncate on public.wallet_withdrawal_requests from anon, authenticated;
revoke delete, truncate on public.wallet_topup_requests from anon, authenticated;
