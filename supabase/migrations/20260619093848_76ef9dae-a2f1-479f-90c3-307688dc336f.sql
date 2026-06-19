
CREATE TABLE public.material_prices (
  material public.material_category PRIMARY KEY,
  label text NOT NULL,
  min_price numeric(12,2) NOT NULL,
  max_price numeric(12,2) NOT NULL,
  unit text NOT NULL DEFAULT '10-15 m³ load',
  enforced boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
GRANT SELECT ON public.material_prices TO authenticated, anon;
GRANT ALL ON public.material_prices TO service_role;
ALTER TABLE public.material_prices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Prices are readable by all" ON public.material_prices FOR SELECT USING (true);
CREATE POLICY "Super admins manage prices" ON public.material_prices FOR ALL
  USING (public.has_role(auth.uid(),'super_admin'))
  WITH CHECK (public.has_role(auth.uid(),'super_admin'));

INSERT INTO public.material_prices(material, label, min_price, max_price) VALUES
  ('river_sand','River sand',160,220),
  ('pit_sand','Pit sand',190,260),
  ('gravel','Gravel',170,230),
  ('quarry_dust','Quarry dust',450,530),
  ('stones','3/4 stones',480,560),
  ('crusher_run','Crusher run',0,0),
  ('top_soil','Top soil',0,0),
  ('filling_soil','Filling soil',0,0),
  ('custom','Other / custom',0,0)
ON CONFLICT (material) DO NOTHING;
UPDATE public.material_prices SET enforced=false WHERE max_price=0;

CREATE OR REPLACE FUNCTION public.tg_validate_job_budget()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE _mp public.material_prices;
BEGIN
  SELECT * INTO _mp FROM public.material_prices WHERE material = NEW.material;
  IF _mp IS NULL OR NOT _mp.enforced THEN RETURN NEW; END IF;
  IF NEW.budget IS NULL THEN RETURN NEW; END IF;
  IF NEW.budget < _mp.min_price OR NEW.budget > _mp.max_price THEN
    RAISE EXCEPTION 'Budget $% is outside the allowed range for % ($%-$%)',
      NEW.budget, _mp.label, _mp.min_price, _mp.max_price;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER jobs_validate_budget
  BEFORE INSERT OR UPDATE OF budget, material ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.tg_validate_job_budget();

CREATE TABLE public.driver_locations (
  job_id uuid PRIMARY KEY REFERENCES public.jobs(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  heading double precision,
  accuracy double precision,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_locations TO authenticated;
GRANT ALL ON public.driver_locations TO service_role;
ALTER TABLE public.driver_locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Driver writes own job location" ON public.driver_locations FOR ALL
  USING (driver_id = auth.uid())
  WITH CHECK (driver_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.jobs j
                WHERE j.id = driver_locations.job_id AND j.driver_id = auth.uid()));
CREATE POLICY "Customer reads location for own job" ON public.driver_locations FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.jobs j
                 WHERE j.id = driver_locations.job_id AND j.customer_id = auth.uid())
         OR public.has_role(auth.uid(),'admin')
         OR public.has_role(auth.uid(),'super_admin'));
CREATE TRIGGER driver_locations_touch BEFORE UPDATE ON public.driver_locations
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

ALTER PUBLICATION supabase_realtime ADD TABLE public.driver_locations;
