-- 0149 — optional post-delivery feedback: "What mattered most about this delivery?"
-- Learning loop: repeat requests alone cannot say why customers come back. One optional, dismissible question
-- after a COMPLETED delivery, answered by the job's customer, at most once per job.
--   * delivery_feedback: one row per job (unique job_id). answer is one of nine choices (NULL only when the
--     customer dismissed the prompt); comment is optional, at most 280 characters. No other personal data.
--   * RLS: a customer reads only their own row. There are NO insert/update/delete policies and clients hold only
--     SELECT, so every write goes through the two RPCs below.
--   * submit_delivery_feedback: caller must be the job's customer, job status must be 'completed', answer must be
--     valid; a second answer is refused (no editing). dismiss_delivery_feedback records that the prompt was
--     dismissed so it is not shown again.
--   * Nothing here touches jobs, payments, wallets or commission: feedback is optional and never blocks completion.
-- Undo: supabase/rollbacks/20261107160000_0149_rollback.sql. NOT APPLIED to any hosted project.

create table if not exists public.delivery_feedback (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique references public.jobs(id) on delete cascade,
  customer_id uuid not null references auth.users(id) on delete cascade,
  answer text,
  comment text,
  dismissed boolean not null default false,
  created_at timestamptz not null default now(),
  constraint delivery_feedback_answer_check check (
    answer is null or answer in (
      'arrived_as_agreed', 'price_worked', 'delivery_quick', 'good_communication', 'could_compare_drivers',
      'confident_choosing', 'properly_confirmed', 'easy_to_arrange', 'other')),
  constraint delivery_feedback_comment_check check (comment is null or char_length(comment) <= 280),
  constraint delivery_feedback_state_check check (answer is not null or dismissed)
);

create index if not exists delivery_feedback_customer_idx on public.delivery_feedback (customer_id);
create index if not exists delivery_feedback_answer_idx on public.delivery_feedback (answer) where answer is not null;

alter table public.delivery_feedback enable row level security;
revoke all on table public.delivery_feedback from anon, authenticated;
grant select on table public.delivery_feedback to authenticated;
grant all on table public.delivery_feedback to service_role;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'delivery_feedback'
                  and policyname = 'delivery_feedback_own_read') then
    create policy delivery_feedback_own_read on public.delivery_feedback
      for select to authenticated using (customer_id = auth.uid());
  end if;
end $$;

create or replace function public.submit_delivery_feedback(_job_id uuid, _answer text, _comment text default null)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  _uid uuid := auth.uid();
  _job public.jobs;
  _clean text := nullif(btrim(coalesce(_comment, '')), '');
begin
  if _uid is null then raise exception 'Sign in required'; end if;
  select * into _job from public.jobs where id = _job_id;
  if not found or _job.customer_id <> _uid then
    raise exception 'Only the customer of a completed delivery can answer' using errcode = '42501';
  end if;
  if _job.status <> 'completed' then
    raise exception 'Feedback is only available once the delivery is completed' using errcode = '22023';
  end if;
  if _answer is null or _answer not in (
      'arrived_as_agreed', 'price_worked', 'delivery_quick', 'good_communication', 'could_compare_drivers',
      'confident_choosing', 'properly_confirmed', 'easy_to_arrange', 'other') then
    raise exception 'Unknown answer' using errcode = '22023';
  end if;
  if _clean is not null and char_length(_clean) > 280 then
    raise exception 'The comment is too long (280 characters at most)' using errcode = '22023';
  end if;

  insert into public.delivery_feedback (job_id, customer_id, answer, comment, dismissed)
  values (_job_id, _uid, _answer, _clean, false)
  on conflict (job_id) do update
     set answer = excluded.answer, comment = excluded.comment, dismissed = false
   where public.delivery_feedback.answer is null;   -- a dismissed prompt may still be answered; an answer is final
  if not found then
    raise exception 'Feedback was already submitted for this delivery' using errcode = '22023';
  end if;
end $$;
revoke all on function public.submit_delivery_feedback(uuid, text, text) from public, anon;
grant execute on function public.submit_delivery_feedback(uuid, text, text) to authenticated, service_role;

create or replace function public.dismiss_delivery_feedback(_job_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  _uid uuid := auth.uid();
  _job public.jobs;
begin
  if _uid is null then raise exception 'Sign in required'; end if;
  select * into _job from public.jobs where id = _job_id;
  if not found or _job.customer_id <> _uid then
    raise exception 'Only the customer of a completed delivery can dismiss this' using errcode = '42501';
  end if;
  if _job.status <> 'completed' then
    raise exception 'Feedback is only available once the delivery is completed' using errcode = '22023';
  end if;
  insert into public.delivery_feedback (job_id, customer_id, answer, comment, dismissed)
  values (_job_id, _uid, null, null, true)
  on conflict (job_id) do nothing;
end $$;
revoke all on function public.dismiss_delivery_feedback(uuid) from public, anon;
grant execute on function public.dismiss_delivery_feedback(uuid) to authenticated, service_role;
