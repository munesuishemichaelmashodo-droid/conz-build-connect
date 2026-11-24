-- -----------------------------------------------------------------------------
-- 0175: payment-link identifiers for provider-collected jobs, stored separately (sandbox work for Linkwa; needs 0171).
--
-- A payment-link provider (Linkwa) identifies one payment with up to four values that arrive at different times:
--   external_payment_link_id, short_url    -> when ConZ creates the link (plus the checkout_url shown to the customer)
--   payment_reference, receipt_id          -> when the customer pays (a payment_reference identifies one ATTEMPT)
-- They are kept in their own columns in provider_payment_refs (one row per ConZ payment). payments.provider_reference
-- is NOT used for them (it stays null for link payments), so 0171's own reference check is unaffected.
--
-- apply_provider_link_payment() wraps 0171's apply_provider_payment():
--   * the reported link (short_url, and the link id when given) must be the link ConZ recorded for that payment;
--     a payment can be found from its short_url when the provider does not echo ConZ's own reference;
--   * the booking reference, when the provider returns one, must be the ConZ payment id (Linkwa returns none: its
--     link id, created by ConZ for exactly one payment and stored once, is the binding);
--   * a paid result must name its payment_reference; a second, different payment_reference on the same link is
--     NOT applied and is flagged for a refund (links are not assumed to be single-use);
--   * a payment_reference or receipt_id already bound to another ConZ payment is refused;
--   * only the words paid / pending / failed / cancelled / expired are accepted as statuses: the adapter maps the
--     provider's own words to these from its documentation. Anything else (e.g. a raw "COMPLETED") is recorded as
--     unrecognised and flagged, never treated as paid;
--   * failed / cancelled / expired describe one checkout ATTEMPT: they are recorded but do NOT close the ConZ payment,
--     because the customer may try again on the same link (a failed attempt does not use it up). The payment closes
--     when it is paid or when the job is cancelled (0171);
--   * amount, currency, duplicate-event and state checks are 0171's, unchanged.
-- Commission is unchanged: 7% of the total agreed deal (jobs.final_price), taken once at settlement (0171).
-- No switch changes: collection stays OFF while system_settings.payment_provider = "none" (0171). No payouts.
-- No DROP, no data changes. Undo: supabase/rollbacks/20261124150000_0175_rollback.sql.
-- Tests: supabase/tests/database/1090_provider_payment_link_refs.test.sql
-- -----------------------------------------------------------------------------

create table if not exists public.provider_payment_refs (
  payment_id               uuid primary key references public.payments(id),
  provider                 text not null check (provider ~ '^[a-z][a-z0-9_]{1,30}$'),
  external_payment_link_id text check (external_payment_link_id is null or length(external_payment_link_id) between 1 and 200),
  short_url                text check (short_url is null or length(short_url) between 1 and 500),
  checkout_url             text check (checkout_url is null or (length(checkout_url) <= 500 and checkout_url ~ '^https://[^[:space:]]+$')),
  payment_reference        text check (payment_reference is null or length(payment_reference) between 1 and 200),
  receipt_id               text check (receipt_id is null or length(receipt_id) between 1 and 200),
  link_claimed_at          timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create unique index if not exists provider_payment_refs_link_id_key
  on public.provider_payment_refs (provider, external_payment_link_id) where external_payment_link_id is not null;
create unique index if not exists provider_payment_refs_short_url_key
  on public.provider_payment_refs (provider, short_url) where short_url is not null;
create unique index if not exists provider_payment_refs_payment_reference_key
  on public.provider_payment_refs (provider, payment_reference) where payment_reference is not null;
create unique index if not exists provider_payment_refs_receipt_id_key
  on public.provider_payment_refs (provider, receipt_id) where receipt_id is not null;

-- Each identifier is written once and never changed; the row is never deleted.
create or replace function public.provider_payment_refs_guard()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'provider_payment_refs rows are never deleted' using errcode = '42501';
  end if;
  if new.payment_id is distinct from old.payment_id or new.provider is distinct from old.provider
     or new.created_at is distinct from old.created_at then
    raise exception 'Payment link record % identity is immutable', old.payment_id using errcode = '42501';
  end if;
  if (old.external_payment_link_id is not null and new.external_payment_link_id is distinct from old.external_payment_link_id)
     or (old.short_url is not null and new.short_url is distinct from old.short_url)
     or (old.checkout_url is not null and new.checkout_url is distinct from old.checkout_url)
     or (old.payment_reference is not null and new.payment_reference is distinct from old.payment_reference)
     or (old.receipt_id is not null and new.receipt_id is distinct from old.receipt_id) then
    raise exception 'Payment link record % identifiers are already set', old.payment_id using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke all on function public.provider_payment_refs_guard() from public, anon, authenticated;
create or replace trigger trg_provider_payment_refs_guard
  before update or delete on public.provider_payment_refs for each row execute function public.provider_payment_refs_guard();

alter table public.provider_payment_refs enable row level security;
revoke all on public.provider_payment_refs from public, anon, authenticated;
grant select on public.provider_payment_refs to authenticated, service_role;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'provider_payment_refs' and policyname = 'provider_payment_refs_admin_read') then
    create policy provider_payment_refs_admin_read on public.provider_payment_refs for select to authenticated
      using (public.has_role(auth.uid(), 'admin'::public.app_role) or public.has_role(auth.uid(), 'super_admin'::public.app_role));
  end if;
end $$;

-- Before creating a link: claim the payment so two requests cannot create two links for it.
-- Returns 'claimed' (go ahead), 'exists' (a link is already recorded: reuse it) or 'in_progress' (another request
-- claimed it less than 2 minutes ago: try again shortly). Service role only.
create or replace function public.provider_claim_payment_link(_payment_id uuid, _provider text)
returns text language plpgsql security definer set search_path to 'public' as $$
declare _p public.payments; _r public.provider_payment_refs;
begin
  select * into _p from public.payments where id = _payment_id for update;
  if not found or _p.type <> 'job_payment' or _p.provider is distinct from _provider then
    raise exception 'Payment not found for this provider';
  end if;
  if _p.status <> 'initiated' then raise exception 'This payment is % and cannot get a payment link', _p.status; end if;
  select * into _r from public.provider_payment_refs where payment_id = _payment_id for update;
  if found then
    if _r.short_url is not null then return 'exists'; end if;
    if _r.link_claimed_at > now() - interval '2 minutes' then return 'in_progress'; end if;
    update public.provider_payment_refs set link_claimed_at = now() where payment_id = _payment_id;
    return 'claimed';
  end if;
  insert into public.provider_payment_refs (payment_id, provider, link_claimed_at) values (_payment_id, _provider, now());
  return 'claimed';
end $$;

-- After the provider created the link: record its id, short URL and checkout URL once. Recording the same values again
-- is a no-op; different values are refused (a payment has exactly one link). Service role only.
create or replace function public.provider_record_payment_link(_payment_id uuid, _provider text,
                                                               _external_payment_link_id text, _short_url text,
                                                               _checkout_url text)
returns public.provider_payment_refs language plpgsql security definer set search_path to 'public' as $$
declare _r public.provider_payment_refs;
begin
  if _external_payment_link_id is null or length(btrim(_external_payment_link_id)) = 0
     or _short_url is null or length(btrim(_short_url)) = 0 then
    raise exception 'The payment link id, short URL and checkout URL are required';
  end if;
  if _checkout_url is null or length(_checkout_url) > 500 or _checkout_url !~ '^https://[^[:space:]]+$' then
    raise exception 'The payment link id, short URL and checkout URL are required';
  end if;
  select * into _r from public.provider_payment_refs where payment_id = _payment_id for update;
  if not found or _r.provider is distinct from _provider then
    raise exception 'Claim the payment link first';
  end if;
  if _r.short_url is not null then
    if _r.short_url = btrim(_short_url) and _r.external_payment_link_id = btrim(_external_payment_link_id)
       and _r.checkout_url = _checkout_url then
      return _r;                                        -- idempotent
    end if;
    raise exception 'This payment already has a different payment link';
  end if;
  update public.provider_payment_refs
     set external_payment_link_id = btrim(_external_payment_link_id), short_url = btrim(_short_url),
         checkout_url = _checkout_url
   where payment_id = _payment_id
  returning * into _r;
  return _r;
end $$;

-- Apply one VERIFIED provider result for a payment-link payment (see header). Call only after the adapter verified
-- the webhook signature and re-checked the status with the provider server to server. Service role only.
create or replace function public.apply_provider_link_payment(
  _provider text, _event_id text, _payment_id uuid, _status text, _amount numeric, _currency text,
  _booking_reference text, _external_payment_link_id text, _short_url text,
  _payment_reference text, _receipt_id text, _source text default 'webhook')
returns text language plpgsql security definer set search_path to 'public' as $$
declare _p public.payments; _r public.provider_payment_refs; _pid uuid := _payment_id; _st text; _outcome text;
        _pref text := nullif(btrim(coalesce(_payment_reference, '')), '');
        _rcpt text := nullif(btrim(coalesce(_receipt_id, '')), '');
begin
  if _event_id is null or length(btrim(_event_id)) = 0 then raise exception 'event_id is required'; end if;
  if _short_url is null or length(btrim(_short_url)) = 0 then raise exception 'short_url is required'; end if;
  if exists (select 1 from public.provider_payment_events e where e.provider = _provider and e.event_id = _event_id) then
    return 'duplicate';
  end if;

  -- Find the payment: by id, or by the link the provider reported.
  if _pid is null then
    select r.payment_id into _pid from public.provider_payment_refs r
     where r.provider = _provider and r.short_url = btrim(_short_url);
  end if;
  if _pid is not null then
    select * into _p from public.payments where id = _pid for update;
  end if;
  if _pid is null or _p.id is null or _p.type <> 'job_payment' or _p.provider is distinct from _provider then
    insert into public.provider_payment_events (provider, event_id, payment_id, source, reported_status, reported_amount,
                                                reported_currency, reported_reference, outcome, detail)
    values (_provider, _event_id, null, _source, _status, _amount, _currency, _pref, 'rejected_unknown_link',
            'link ' || btrim(_short_url))
    on conflict (provider, event_id) do nothing;
    perform public.notify_finance_admins('Payment on an unknown payment link',
      format('%s reported "%s" ($%s %s, payment ref %s) on link %s, which matches no ConZ payment. Check it and refund if money was taken.',
             _provider, _status, _amount, _currency, coalesce(_pref, '-'), btrim(_short_url)));
    return 'rejected_unknown_link';
  end if;

  select * into _r from public.provider_payment_refs where payment_id = _p.id for update;
  _st := case when lower(btrim(coalesce(_status, ''))) in ('paid', 'pending', 'failed', 'cancelled', 'expired')
              then lower(btrim(_status)) else 'unrecognised:' || coalesce(_status, '') end;

  _outcome := case
    when _r.payment_id is null or _r.short_url is null or _r.short_url <> btrim(_short_url) then 'rejected_link'
    when _external_payment_link_id is not null and _r.external_payment_link_id is distinct from btrim(_external_payment_link_id) then 'rejected_link'
    when _booking_reference is not null and btrim(_booking_reference) <> _p.id::text then 'rejected_booking_reference'
    when _st = 'paid' and _pref is null then 'rejected_payment_reference'
    when _st = 'paid' and _r.payment_reference is not null and _r.payment_reference <> _pref then 'second_payment_flagged'
    when _st = 'paid' and exists (select 1 from public.provider_payment_refs o where o.provider = _provider
                                    and o.payment_reference = _pref and o.payment_id <> _p.id) then 'rejected_payment_reference'
    when _st = 'paid' and _rcpt is not null and exists (select 1 from public.provider_payment_refs o where o.provider = _provider
                                    and o.receipt_id = _rcpt and o.payment_id <> _p.id) then 'rejected_receipt_reuse'
    when _st = 'paid' and _rcpt is not null and _r.receipt_id is not null and _r.receipt_id <> _rcpt then 'rejected_receipt_reuse'
    else null end;

  if _outcome is not null then
    insert into public.provider_payment_events (provider, event_id, payment_id, source, reported_status, reported_amount,
                                                reported_currency, reported_reference, outcome, detail)
    values (_provider, _event_id, _p.id, _source, _status, _amount, _currency, _pref, _outcome,
            format('link %s / %s, booking %s, receipt %s', btrim(_short_url), coalesce(_external_payment_link_id, '-'),
                   coalesce(_booking_reference, '-'), coalesce(_rcpt, '-')));
    perform public.notify_payment_anomaly(_p.id,
      case when _outcome = 'second_payment_flagged' then 'Second payment on the same payment link'
           else 'Payment provider event needs review' end,
      format('Payment %s: %s reported "%s" ($%s %s, payment ref %s) on link %s; outcome %s.%s', _p.id, _provider, _status,
             _amount, _currency, coalesce(_pref, '-'), btrim(_short_url), _outcome,
             case when _outcome = 'second_payment_flagged' then ' The customer may have paid twice: refund the extra payment through the provider.' else '' end));
    return _outcome;
  end if;

  -- One checkout attempt ended without money: record it; the payment stays open for another attempt on the same link.
  if _st in ('failed', 'cancelled', 'expired') then
    _outcome := 'attempt_' || _st;
    insert into public.provider_payment_events (provider, event_id, payment_id, source, reported_status, reported_amount,
                                                reported_currency, reported_reference, outcome, detail)
    values (_provider, _event_id, _p.id, _source, _status, _amount, _currency, _pref, _outcome, 'link ' || btrim(_short_url));
    return _outcome;
  end if;

  -- 0171 checks amount, currency, state and duplicates and posts the ledger. The link identifiers are passed as
  -- null reference on purpose: they live in provider_payment_refs, never in payments.provider_reference.
  _outcome := public.apply_provider_payment(_provider, _event_id, _p.id, _st, _amount, _currency, null, _source);

  if _outcome = 'applied_paid' then
    update public.provider_payment_refs
       set payment_reference = _pref, receipt_id = coalesce(receipt_id, _rcpt)
     where payment_id = _p.id;
  elsif _outcome = 'already_paid' and _r.payment_reference = _pref and _r.receipt_id is null and _rcpt is not null then
    update public.provider_payment_refs set receipt_id = _rcpt where payment_id = _p.id;
  end if;
  return _outcome;
end $$;

revoke all on function public.provider_claim_payment_link(uuid, text) from public, anon, authenticated;
revoke all on function public.provider_record_payment_link(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.apply_provider_link_payment(text, text, uuid, text, numeric, text, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.provider_claim_payment_link(uuid, text) to service_role;
grant execute on function public.provider_record_payment_link(uuid, text, text, text, text) to service_role;
grant execute on function public.apply_provider_link_payment(text, text, uuid, text, numeric, text, text, text, text, text, text, text)
  to service_role;
