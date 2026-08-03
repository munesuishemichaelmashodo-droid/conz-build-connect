CREATE OR REPLACE FUNCTION public.driver_active_jobs()
RETURNS TABLE (
  id uuid, material public.material_category, custom_material text, quantity_m3 numeric,
  delivery_address text, budget numeric, final_price numeric, status public.job_status,
  customer_id uuid, customer_name text, customer_phone text,
  pickup_photo_url text, delivery_photo_url text, created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT j.id, j.material, j.custom_material, j.quantity_m3, j.delivery_address, j.budget,
         j.final_price, j.status, j.customer_id, p.full_name, p.phone,
         j.pickup_photo_url, j.delivery_photo_url, j.created_at
  FROM public.jobs j
  LEFT JOIN public.profiles p ON p.id = j.customer_id
  WHERE j.driver_id = auth.uid() AND j.status IN ('accepted','in_progress')
  ORDER BY j.created_at DESC
$$;

CREATE OR REPLACE FUNCTION public.driver_job_history(_limit integer DEFAULT 30, _offset integer DEFAULT 0)
RETURNS TABLE (
  id uuid, material public.material_category, custom_material text, quantity_m3 numeric,
  delivery_address text, status public.job_status, final_price numeric, commission numeric,
  net_earned numeric, cancelled_by_me boolean, cancellation_reason text,
  customer_name text, completed_at timestamptz, cancelled_at timestamptz, total_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT j.id, j.material, j.custom_material, j.quantity_m3, j.delivery_address, j.status,
         j.final_price, j.commission,
         GREATEST(COALESCE(j.final_price, j.budget, 0) - COALESCE(j.commission, 0), 0) AS net_earned,
         (j.cancelled_by = auth.uid()) AS cancelled_by_me,
         j.cancellation_reason,
         p.full_name AS customer_name,
         CASE WHEN j.status = 'completed' THEN j.updated_at END AS completed_at,
         j.cancelled_at,
         COUNT(*) OVER () AS total_count
  FROM public.jobs j
  LEFT JOIN public.profiles p ON p.id = j.customer_id
  WHERE j.driver_id = auth.uid() AND j.status IN ('completed','cancelled')
  ORDER BY COALESCE(j.cancelled_at, j.updated_at) DESC
  LIMIT GREATEST(COALESCE(_limit, 30), 1) OFFSET GREATEST(COALESCE(_offset, 0), 0)
$$;

GRANT EXECUTE ON FUNCTION public.driver_active_jobs() TO authenticated;
GRANT EXECUTE ON FUNCTION public.driver_job_history(integer, integer) TO authenticated;