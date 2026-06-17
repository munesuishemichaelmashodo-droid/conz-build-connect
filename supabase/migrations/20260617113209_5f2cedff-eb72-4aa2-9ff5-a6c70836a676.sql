
-- Fix search_path on remaining functions
ALTER FUNCTION public.tg_touch_updated_at() SET search_path = public;
ALTER FUNCTION public.tg_driver_level() SET search_path = public;
ALTER FUNCTION public.tg_rating_aggregate() SET search_path = public;

-- Restrict public execute on SECURITY DEFINER functions
REVOKE EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.accept_bid(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_job(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.accept_bid(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_job(UUID) TO authenticated;

-- ============ STORAGE POLICIES ============
-- driver-docs: path layout {user_id}/{filename}
CREATE POLICY "driver docs read own" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id='driver-docs' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "driver docs admin read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id='driver-docs' AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')));
CREATE POLICY "driver docs upload own" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id='driver-docs' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "driver docs update own" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id='driver-docs' AND (storage.foldername(name))[1] = auth.uid()::text);

-- chat-media: path layout {job_id}/{user_id}/{filename}
CREATE POLICY "chat media read participants" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id='chat-media'
    AND EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.id::text = (storage.foldername(name))[1]
        AND (j.customer_id = auth.uid() OR j.driver_id = auth.uid()
             OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'))
    )
  );
CREATE POLICY "chat media upload participants" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id='chat-media'
    AND (storage.foldername(name))[2] = auth.uid()::text
    AND EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.id::text = (storage.foldername(name))[1]
        AND (j.customer_id = auth.uid() OR j.driver_id = auth.uid())
    )
  );
