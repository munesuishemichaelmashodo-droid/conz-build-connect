-- ConZ: requests for materials that cannot yet be automatically quoted.
-- These are NOT jobs and must never appear in driver job feeds.

CREATE TABLE public.material_sourcing_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  material public.material_category NOT NULL,
  custom_material TEXT,
  quantity_m3 NUMERIC(8,2) NOT NULL CHECK (quantity_m3 > 0),

  delivery_address TEXT NOT NULL CHECK (length(trim(delivery_address)) > 0),
  delivery_lat DOUBLE PRECISION,
  delivery_lng DOUBLE PRECISION,
  preferred_date DATE,
  notes TEXT,

  status TEXT NOT NULL DEFAULT 'requested'
    CHECK (status IN (
      'requested',
      'sourcing',
      'quote_ready',
      'declined',
      'expired',
      'converted'
    )),

  admin_notes TEXT,
  supplier_name TEXT,
  supplier_contact TEXT,
  supplier_location TEXT,
  quoted_total NUMERIC(10,2) CHECK (quoted_total IS NULL OR quoted_total > 0),
  expires_at TIMESTAMPTZ,
  converted_job_id UUID REFERENCES public.jobs(id) ON DELETE RESTRICT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT sourcing_lat_valid
    CHECK (delivery_lat IS NULL OR delivery_lat BETWEEN -90 AND 90),
  CONSTRAINT sourcing_lng_valid
    CHECK (delivery_lng IS NULL OR delivery_lng BETWEEN -180 AND 180),
  CONSTRAINT sourcing_custom_material_valid
    CHECK (
      (material::text = 'custom' AND length(trim(coalesce(custom_material, ''))) > 0)
      OR
      (material::text <> 'custom' AND custom_material IS NULL)
    )
);

CREATE INDEX idx_sourcing_customer_created
  ON public.material_sourcing_requests (customer_id, created_at DESC);

CREATE INDEX idx_sourcing_admin_queue
  ON public.material_sourcing_requests (status, created_at DESC);

ALTER TABLE public.material_sourcing_requests ENABLE ROW LEVEL SECURITY;

-- Start from no table privileges; grant only what the workflow needs.
REVOKE ALL ON TABLE public.material_sourcing_requests
  FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.material_sourcing_requests TO authenticated;
GRANT ALL ON TABLE public.material_sourcing_requests TO service_role;

-- Customers can read their own requests. Admins can review all requests.
CREATE POLICY "Customers read own sourcing requests"
  ON public.material_sourcing_requests
  FOR SELECT TO authenticated
  USING (customer_id = auth.uid());

CREATE POLICY "Admins read sourcing requests"
  ON public.material_sourcing_requests
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
  );

-- Customers cannot directly insert requests or change their status.
-- Admins may update only the operational fields listed here.
GRANT UPDATE (
  status,
  admin_notes,
  supplier_name,
  supplier_contact,
  supplier_location,
  quoted_total,
  expires_at,
  converted_job_id,
  updated_at
) ON public.material_sourcing_requests TO authenticated;

-- Do not allow direct status transitions or direct job linking.
-- A dedicated, validated admin function will manage those operations.
REVOKE UPDATE (status, converted_job_id)
  ON public.material_sourcing_requests FROM authenticated;
CREATE POLICY "Admins update sourcing requests"
  ON public.material_sourcing_requests
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
  );

-- Customer submission uses a trusted function rather than direct table INSERT.
CREATE OR REPLACE FUNCTION public.create_material_sourcing_request(
  p_material public.material_category,
  p_custom_material TEXT,
  p_quantity_m3 NUMERIC,
  p_delivery_address TEXT,
  p_delivery_lat DOUBLE PRECISION DEFAULT NULL,
  p_delivery_lng DOUBLE PRECISION DEFAULT NULL,
  p_preferred_date DATE DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
    customer_id,
    material,
    custom_material,
    quantity_m3,
    delivery_address,
    delivery_lat,
    delivery_lng,
    preferred_date,
    notes
  )
  VALUES (
    v_customer_id,
    p_material,
    CASE WHEN p_material::text = 'custom'
      THEN trim(p_custom_material) ELSE NULL END,
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
$$;

REVOKE ALL ON FUNCTION public.create_material_sourcing_request(
  public.material_category, TEXT, NUMERIC, TEXT,
  DOUBLE PRECISION, DOUBLE PRECISION, DATE, TEXT
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_material_sourcing_request(
  public.material_category, TEXT, NUMERIC, TEXT,
  DOUBLE PRECISION, DOUBLE PRECISION, DATE, TEXT
) TO authenticated;

-- A converted request must reference an existing job.
ALTER TABLE public.material_sourcing_requests
  ADD CONSTRAINT sourcing_converted_requires_job
  CHECK (status <> 'converted' OR converted_job_id IS NOT NULL);

-- Keep updated_at consistent with the rest of ConZ.
CREATE TRIGGER t_material_sourcing_requests_updated
  BEFORE UPDATE ON public.material_sourcing_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_touch_updated_at();

