-- 0087_material_sourcing_requests
--
-- RECOVERED FROM LIVE (11/10/2026). These objects already exist in production
-- (project ovwrsocjmkpiygipmrdk) but were applied without being committed to
-- git or recorded in supabase_migrations.schema_migrations. This file is a
-- faithful, idempotent reconstruction of the live definitions, introspected
-- read-only from pg_catalog / pg_policies / pg_proc. It is safe to replay on
-- live (every statement is a no-op there) and on a fresh database.
--
-- Known gaps vs. the nationwide-sourcing requirements (addressed in 0088):
--   * no idempotency key => a retried submit creates duplicate requests
--   * no status-history / decision trail
--   * admins can UPDATE rows directly (quoted_total, status) with no
--     validation of supplier / price / pickup / terms
--   * no per-customer rate limit
--   * no verified-quote link before conversion to a job

CREATE TABLE IF NOT EXISTS public.material_sourcing_requests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  material          public.material_category NOT NULL,
  custom_material   text,
  quantity_m3       numeric NOT NULL,
  delivery_address  text NOT NULL,
  delivery_lat      double precision,
  delivery_lng      double precision,
  preferred_date    date,
  notes             text,
  status            text NOT NULL DEFAULT 'requested',
  supplier_name     text,
  supplier_contact  text,
  supplier_location text,
  quoted_total      numeric,
  admin_notes       text,
  expires_at        timestamptz,
  converted_job_id  uuid REFERENCES public.jobs(id) ON DELETE RESTRICT,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT material_sourcing_requests_delivery_address_check
    CHECK (length(btrim(delivery_address)) > 0),
  CONSTRAINT material_sourcing_requests_quantity_m3_check
    CHECK (quantity_m3 > 0),
  CONSTRAINT material_sourcing_requests_quoted_total_check
    CHECK (quoted_total IS NULL OR quoted_total > 0),
  CONSTRAINT material_sourcing_requests_status_check
    CHECK (status = ANY (ARRAY['requested','sourcing','quote_ready','declined','expired','converted'])),
  CONSTRAINT sourcing_converted_requires_job
    CHECK (status <> 'converted' OR converted_job_id IS NOT NULL),
  CONSTRAINT sourcing_custom_material_valid
    CHECK ((material::text = 'custom' AND length(btrim(COALESCE(custom_material, ''))) > 0)
        OR (material::text <> 'custom' AND custom_material IS NULL)),
  CONSTRAINT sourcing_lat_valid
    CHECK (delivery_lat IS NULL OR (delivery_lat BETWEEN -90 AND 90)),
  CONSTRAINT sourcing_lng_valid
    CHECK (delivery_lng IS NULL OR (delivery_lng BETWEEN -180 AND 180))
);

CREATE INDEX IF NOT EXISTS idx_sourcing_admin_queue
  ON public.material_sourcing_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sourcing_customer_created
  ON public.material_sourcing_requests (customer_id, created_at DESC);

ALTER TABLE public.material_sourcing_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Customers read own sourcing requests" ON public.material_sourcing_requests;
CREATE POLICY "Customers read own sourcing requests"
  ON public.material_sourcing_requests FOR SELECT TO authenticated
  USING (customer_id = auth.uid());

DROP POLICY IF EXISTS "Admins read sourcing requests" ON public.material_sourcing_requests;
CREATE POLICY "Admins read sourcing requests"
  ON public.material_sourcing_requests FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'super_admin'::public.app_role));

DROP POLICY IF EXISTS "Admins update sourcing requests" ON public.material_sourcing_requests;
CREATE POLICY "Admins update sourcing requests"
  ON public.material_sourcing_requests FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'super_admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'super_admin'::public.app_role));

-- Live grants: authenticated has SELECT only; writes go through the RPC below.
REVOKE ALL ON public.material_sourcing_requests FROM PUBLIC, anon;
GRANT SELECT ON public.material_sourcing_requests TO authenticated;

DROP TRIGGER IF EXISTS t_material_sourcing_requests_updated ON public.material_sourcing_requests;
CREATE TRIGGER t_material_sourcing_requests_updated
  BEFORE UPDATE ON public.material_sourcing_requests
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

CREATE OR REPLACE FUNCTION public.create_material_sourcing_request(
  p_material         public.material_category,
  p_custom_material  text,
  p_quantity_m3      numeric,
  p_delivery_address text,
  p_delivery_lat     double precision DEFAULT NULL,
  p_delivery_lng     double precision DEFAULT NULL,
  p_preferred_date   date DEFAULT NULL,
  p_notes            text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_customer_id UUID := auth.uid();
  v_request_id UUID;
BEGIN
  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.has_role(v_customer_id, 'customer') THEN
    RAISE EXCEPTION 'Only customer accounts can submit sourcing requests';
  END IF;

  IF p_quantity_m3 IS NULL OR p_quantity_m3 <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than zero';
  END IF;

  IF p_quantity_m3 > 999999.99 THEN
    RAISE EXCEPTION 'Quantity is too large';
  END IF;

  IF p_delivery_address IS NULL
     OR length(trim(p_delivery_address)) = 0
     OR length(trim(p_delivery_address)) > 500 THEN
    RAISE EXCEPTION 'Enter a valid delivery address';
  END IF;

  IF (p_delivery_lat IS NULL) <> (p_delivery_lng IS NULL) THEN
    RAISE EXCEPTION 'Provide both delivery coordinates or neither';
  END IF;

  IF p_delivery_lat IS NOT NULL
     AND (p_delivery_lat NOT BETWEEN -90 AND 90
       OR p_delivery_lng NOT BETWEEN -180 AND 180) THEN
    RAISE EXCEPTION 'Invalid delivery coordinates';
  END IF;

  IF p_material::text = 'custom' THEN
    IF p_custom_material IS NULL
       OR length(trim(p_custom_material)) = 0
       OR length(trim(p_custom_material)) > 120 THEN
      RAISE EXCEPTION 'Describe the custom material';
    END IF;
  ELSIF p_custom_material IS NOT NULL THEN
    RAISE EXCEPTION 'Custom material description is only allowed for custom requests';
  END IF;

  IF p_notes IS NOT NULL AND length(p_notes) > 2000 THEN
    RAISE EXCEPTION 'Notes are too long';
  END IF;

  INSERT INTO public.material_sourcing_requests (
    customer_id, material, custom_material, quantity_m3, delivery_address,
    delivery_lat, delivery_lng, preferred_date, notes
  )
  VALUES (
    v_customer_id,
    p_material,
    CASE WHEN p_material::text = 'custom' THEN trim(p_custom_material) ELSE NULL END,
    p_quantity_m3,
    trim(p_delivery_address),
    p_delivery_lat,
    p_delivery_lng,
    p_preferred_date,
    NULLIF(trim(p_notes), '')
  )
  RETURNING id INTO v_request_id;

  RETURN v_request_id;
END;
$function$;

-- Live ACL: {postgres, authenticated, service_role}; no PUBLIC / anon.
REVOKE ALL ON FUNCTION public.create_material_sourcing_request(
  public.material_category, text, numeric, text, double precision, double precision, date, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_material_sourcing_request(
  public.material_category, text, numeric, text, double precision, double precision, date, text
) TO authenticated, service_role;
