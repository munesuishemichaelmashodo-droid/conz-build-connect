-- =============================================================================
-- 0084 — Commit live-only objects so a fresh database matches production
-- =============================================================================
--
-- The Phase 16 invariant tests failed on a fresh database built from git
-- because some objects exist ONLY in production (created before the 13/08
-- baseline, which snapshotted the public schema's functions/tables but not
-- every trigger, and not the storage schema). Compared live vs fresh
-- (read-only introspection, 08/10/2026); live-only objects that matter:
--   * trigger wallet_transactions_immutable (the ledger immutability guard!)
--   * trigger storage.objects storage_evidence_guard (delivery photos cannot
--     be replaced or deleted by clients)
--   * storage policies for chat-media and job-proof-photos
--   * bucket job-proof-photos
-- Every statement is idempotent: on production (where all of these already
-- exist) this migration changes nothing; on a fresh database it creates them
-- exactly as they are defined live.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'wallet_transactions_immutable'
                   and tgrelid = 'public.wallet_transactions'::regclass) then
    create trigger wallet_transactions_immutable
      before delete or update on public.wallet_transactions
      for each row execute function public.prevent_wallet_tx_mutation();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'storage_evidence_guard'
                   and tgrelid = 'storage.objects'::regclass) then
    create trigger storage_evidence_guard
      before delete or update on storage.objects
      for each row execute function public.storage_protect_evidence();
  end if;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('job-proof-photos', 'job-proof-photos', false, 10485760, array['image/jpeg','image/png','image/webp','image/heic'])
on conflict (id) do nothing;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'chat media read participants') then
    create policy "chat media read participants" on storage.objects for select to authenticated
      using ((bucket_id = 'chat-media') and exists (select 1 from public.jobs j
              where (j.id)::text = (storage.foldername(objects.name))[1]
                and (j.customer_id = auth.uid() or j.driver_id = auth.uid()
                     or public.has_role(auth.uid(), 'admin'::app_role) or public.has_role(auth.uid(), 'super_admin'::app_role))));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'chat media upload participants') then
    create policy "chat media upload participants" on storage.objects for insert to authenticated
      with check ((bucket_id = 'chat-media') and (storage.foldername(name))[2] = (auth.uid())::text
                  and exists (select 1 from public.jobs j
                               where (j.id)::text = (storage.foldername(objects.name))[1]
                                 and (j.customer_id = auth.uid() or j.driver_id = auth.uid())));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'job proof: driver upload') then
    create policy "job proof: driver upload" on storage.objects for insert to authenticated
      with check ((bucket_id = 'job-proof-photos') and exists (select 1 from public.jobs j
                   where (j.id)::text = (storage.foldername(objects.name))[1]
                     and j.driver_id = auth.uid() and j.status = any (array['accepted'::job_status, 'in_progress'::job_status])));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'job proof: parties read') then
    create policy "job proof: parties read" on storage.objects for select to authenticated
      using ((bucket_id = 'job-proof-photos') and (exists (select 1 from public.jobs j
               where (j.id)::text = (storage.foldername(objects.name))[1]
                 and (j.customer_id = auth.uid() or j.driver_id = auth.uid()))
             or public.has_role(auth.uid(), 'admin'::app_role) or public.has_role(auth.uid(), 'super_admin'::app_role)));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'job proof: admin all') then
    create policy "job proof: admin all" on storage.objects for all to authenticated
      using ((bucket_id = 'job-proof-photos') and (public.has_role(auth.uid(), 'admin'::app_role) or public.has_role(auth.uid(), 'super_admin'::app_role)));
  end if;
end $$;
