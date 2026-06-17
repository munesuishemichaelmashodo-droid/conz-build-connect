
-- ============ ENUMS ============
CREATE TYPE public.app_role AS ENUM ('customer','driver','admin','super_admin');
CREATE TYPE public.account_status AS ENUM ('active','suspended','banned');
CREATE TYPE public.verification_status AS ENUM ('pending','verified','rejected');
CREATE TYPE public.driver_level AS ENUM ('bronze','silver','gold','platinum');
CREATE TYPE public.job_status AS ENUM ('open','accepted','in_progress','completed','cancelled');
CREATE TYPE public.bid_status AS ENUM ('pending','accepted','rejected','withdrawn');
CREATE TYPE public.material_category AS ENUM ('river_sand','pit_sand','quarry_dust','crusher_run','gravel','stones','top_soil','filling_soil','custom');
CREATE TYPE public.tx_type AS ENUM ('topup','commission','refund','adjustment');
CREATE TYPE public.dispute_status AS ENUM ('open','investigating','resolved','rejected');

-- ============ PROFILES ============
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  avatar_url TEXT,
  status public.account_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Profiles readable by authenticated" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid()=id) WITH CHECK (auth.uid()=id);
CREATE POLICY "Users insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid()=id);

-- ============ USER ROLES ============
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own roles" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND role=_role)
$$;

-- Admin policies for roles
CREATE POLICY "Admins manage roles" ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'))
  WITH CHECK (public.has_role(auth.uid(),'super_admin'));

-- ============ DRIVER PROFILES ============
CREATE TABLE public.driver_profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  national_id TEXT,
  national_id_url TEXT,
  selfie_url TEXT,
  verification_status public.verification_status NOT NULL DEFAULT 'pending',
  verification_notes TEXT,
  level public.driver_level NOT NULL DEFAULT 'bronze',
  rating_avg NUMERIC(3,2) NOT NULL DEFAULT 0,
  rating_count INT NOT NULL DEFAULT 0,
  jobs_completed INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.driver_profiles TO authenticated;
GRANT ALL ON public.driver_profiles TO service_role;
ALTER TABLE public.driver_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Driver profiles readable by authenticated" ON public.driver_profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Drivers manage own profile" ON public.driver_profiles FOR ALL TO authenticated USING (user_id=auth.uid()) WITH CHECK (user_id=auth.uid());
CREATE POLICY "Admins update driver profiles" ON public.driver_profiles FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));

-- ============ TRUCKS ============
CREATE TABLE public.trucks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  registration TEXT NOT NULL,
  capacity_m3 NUMERIC(6,2) NOT NULL,
  photo_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trucks TO authenticated;
GRANT ALL ON public.trucks TO service_role;
ALTER TABLE public.trucks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Trucks readable by authenticated" ON public.trucks FOR SELECT TO authenticated USING (true);
CREATE POLICY "Drivers manage own trucks" ON public.trucks FOR ALL TO authenticated USING (driver_id=auth.uid()) WITH CHECK (driver_id=auth.uid());

-- ============ WALLETS ============
CREATE TABLE public.wallets (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  limited BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.wallets TO authenticated;
GRANT ALL ON public.wallets TO service_role;
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own wallet" ON public.wallets FOR SELECT TO authenticated USING (user_id=auth.uid());
CREATE POLICY "Admins read wallets" ON public.wallets FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));

-- ============ JOBS ============
CREATE TABLE public.jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  driver_id UUID REFERENCES auth.users(id),
  material public.material_category NOT NULL,
  custom_material TEXT,
  quantity_m3 NUMERIC(8,2) NOT NULL,
  delivery_address TEXT NOT NULL,
  budget NUMERIC(10,2) NOT NULL,
  preferred_date DATE,
  notes TEXT,
  status public.job_status NOT NULL DEFAULT 'open',
  accepted_bid_id UUID,
  final_price NUMERIC(10,2),
  commission NUMERIC(10,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_jobs_status ON public.jobs(status);
CREATE INDEX idx_jobs_customer ON public.jobs(customer_id);
CREATE INDEX idx_jobs_driver ON public.jobs(driver_id);
GRANT SELECT, INSERT, UPDATE ON public.jobs TO authenticated;
GRANT ALL ON public.jobs TO service_role;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
-- Customers see own jobs; drivers see open jobs OR jobs assigned to them; admins see all
CREATE POLICY "Jobs visibility" ON public.jobs FOR SELECT TO authenticated USING (
  customer_id = auth.uid()
  OR driver_id = auth.uid()
  OR (status='open' AND public.has_role(auth.uid(),'driver'))
  OR public.has_role(auth.uid(),'admin')
  OR public.has_role(auth.uid(),'super_admin')
);
CREATE POLICY "Customers create jobs" ON public.jobs FOR INSERT TO authenticated
  WITH CHECK (customer_id = auth.uid() AND public.has_role(auth.uid(),'customer'));
CREATE POLICY "Customers update own jobs" ON public.jobs FOR UPDATE TO authenticated USING (customer_id=auth.uid());
CREATE POLICY "Drivers update assigned jobs" ON public.jobs FOR UPDATE TO authenticated USING (driver_id=auth.uid());
CREATE POLICY "Admins update jobs" ON public.jobs FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));

-- ============ BIDS ============
CREATE TABLE public.bids (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  driver_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  price NUMERIC(10,2) NOT NULL,
  delivery_date DATE,
  message TEXT,
  status public.bid_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(job_id, driver_id)
);
CREATE INDEX idx_bids_job ON public.bids(job_id);
CREATE INDEX idx_bids_driver ON public.bids(driver_id);
GRANT SELECT, INSERT, UPDATE ON public.bids TO authenticated;
GRANT ALL ON public.bids TO service_role;
ALTER TABLE public.bids ENABLE ROW LEVEL SECURITY;
-- Driver sees own bids, customer sees bids on their jobs, admins see all
CREATE POLICY "Bids visibility" ON public.bids FOR SELECT TO authenticated USING (
  driver_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.jobs j WHERE j.id=job_id AND j.customer_id=auth.uid())
  OR public.has_role(auth.uid(),'admin')
  OR public.has_role(auth.uid(),'super_admin')
);
CREATE POLICY "Drivers create bids" ON public.bids FOR INSERT TO authenticated
  WITH CHECK (
    driver_id = auth.uid()
    AND public.has_role(auth.uid(),'driver')
    AND EXISTS (SELECT 1 FROM public.wallets w WHERE w.user_id=auth.uid() AND w.limited=false)
  );
CREATE POLICY "Drivers update own bids" ON public.bids FOR UPDATE TO authenticated USING (driver_id=auth.uid());
CREATE POLICY "Customers update bids on own jobs" ON public.bids FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.jobs j WHERE j.id=job_id AND j.customer_id=auth.uid()));

-- ============ WALLET TRANSACTIONS ============
CREATE TABLE public.wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type public.tx_type NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  balance_after NUMERIC(12,2) NOT NULL,
  job_id UUID REFERENCES public.jobs(id) ON DELETE SET NULL,
  note TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_wtx_user ON public.wallet_transactions(user_id, created_at DESC);
GRANT SELECT ON public.wallet_transactions TO authenticated;
GRANT ALL ON public.wallet_transactions TO service_role;
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own tx" ON public.wallet_transactions FOR SELECT TO authenticated USING (user_id=auth.uid());
CREATE POLICY "Admins read tx" ON public.wallet_transactions FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));

-- ============ RATINGS ============
CREATE TABLE public.ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  driver_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  quality INT NOT NULL CHECK (quality BETWEEN 1 AND 5),
  communication INT NOT NULL CHECK (communication BETWEEN 1 AND 5),
  reliability INT NOT NULL CHECK (reliability BETWEEN 1 AND 5),
  delivery_time INT NOT NULL CHECK (delivery_time BETWEEN 1 AND 5),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(job_id)
);
GRANT SELECT, INSERT ON public.ratings TO authenticated;
GRANT ALL ON public.ratings TO service_role;
ALTER TABLE public.ratings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Ratings readable by authenticated" ON public.ratings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Customers rate own completed jobs" ON public.ratings FOR INSERT TO authenticated
  WITH CHECK (customer_id=auth.uid() AND EXISTS (SELECT 1 FROM public.jobs j WHERE j.id=job_id AND j.customer_id=auth.uid() AND j.status='completed'));

-- ============ MESSAGES ============
CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body TEXT,
  image_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_messages_job ON public.messages(job_id, created_at);
GRANT SELECT, INSERT ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
-- Only customer & accepted driver on the job (or admin) may read/send
CREATE POLICY "Messages visibility" ON public.messages FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.jobs j WHERE j.id=job_id AND (j.customer_id=auth.uid() OR j.driver_id=auth.uid()))
  OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')
);
CREATE POLICY "Messages send" ON public.messages FOR INSERT TO authenticated WITH CHECK (
  sender_id=auth.uid()
  AND EXISTS (SELECT 1 FROM public.jobs j WHERE j.id=job_id AND (j.customer_id=auth.uid() OR j.driver_id=auth.uid()))
);

-- ============ DISPUTES ============
CREATE TABLE public.disputes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  raised_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  against UUID REFERENCES auth.users(id),
  reason TEXT NOT NULL,
  status public.dispute_status NOT NULL DEFAULT 'open',
  resolution TEXT,
  resolved_by UUID REFERENCES auth.users(id),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.disputes TO authenticated;
GRANT ALL ON public.disputes TO service_role;
ALTER TABLE public.disputes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Disputes visibility" ON public.disputes FOR SELECT TO authenticated USING (
  raised_by=auth.uid() OR against=auth.uid()
  OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')
);
CREATE POLICY "Users raise disputes" ON public.disputes FOR INSERT TO authenticated WITH CHECK (raised_by=auth.uid());
CREATE POLICY "Admins resolve disputes" ON public.disputes FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));

-- ============ SYSTEM SETTINGS ============
CREATE TABLE public.system_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id)
);
GRANT SELECT ON public.system_settings TO authenticated;
GRANT ALL ON public.system_settings TO service_role;
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Settings readable by authenticated" ON public.system_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Super admin manages settings" ON public.system_settings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'super_admin')) WITH CHECK (public.has_role(auth.uid(),'super_admin'));

INSERT INTO public.system_settings(key,value) VALUES ('commission_rate','7'::jsonb);

-- ============ TRIGGERS ============

-- updated_at helper
CREATE OR REPLACE FUNCTION public.tg_touch_updated_at() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
CREATE TRIGGER t_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
CREATE TRIGGER t_driver_updated BEFORE UPDATE ON public.driver_profiles FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
CREATE TRIGGER t_jobs_updated BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- New auth user → create profile, role (from metadata), and wallet if driver
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.app_role;
BEGIN
  INSERT INTO public.profiles(id, full_name, phone, email)
  VALUES (NEW.id,
          COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
          NEW.raw_user_meta_data->>'phone',
          NEW.email);

  r := COALESCE((NEW.raw_user_meta_data->>'role')::public.app_role, 'customer');
  INSERT INTO public.user_roles(user_id, role) VALUES (NEW.id, r) ON CONFLICT DO NOTHING;

  IF r = 'driver' THEN
    INSERT INTO public.driver_profiles(user_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
    INSERT INTO public.wallets(user_id, balance) VALUES (NEW.id, 0) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Driver level recompute based on jobs_completed
CREATE OR REPLACE FUNCTION public.tg_driver_level() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.level := CASE
    WHEN NEW.jobs_completed >= 500 THEN 'platinum'::public.driver_level
    WHEN NEW.jobs_completed >= 101 THEN 'gold'::public.driver_level
    WHEN NEW.jobs_completed >= 21  THEN 'silver'::public.driver_level
    ELSE 'bronze'::public.driver_level
  END;
  RETURN NEW;
END $$;
CREATE TRIGGER t_driver_level BEFORE UPDATE OF jobs_completed ON public.driver_profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_driver_level();

-- Accept a bid: assign driver, set job accepted (called via RPC for atomicity)
CREATE OR REPLACE FUNCTION public.accept_bid(_bid_id UUID) RETURNS public.jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _bid public.bids; _job public.jobs;
BEGIN
  SELECT * INTO _bid FROM public.bids WHERE id=_bid_id;
  IF _bid IS NULL THEN RAISE EXCEPTION 'Bid not found'; END IF;
  SELECT * INTO _job FROM public.jobs WHERE id=_bid.job_id;
  IF _job.customer_id <> auth.uid() THEN RAISE EXCEPTION 'Not your job'; END IF;
  IF _job.status <> 'open' THEN RAISE EXCEPTION 'Job not open'; END IF;

  UPDATE public.bids SET status='accepted' WHERE id=_bid_id;
  UPDATE public.bids SET status='rejected' WHERE job_id=_job.id AND id<>_bid_id;
  UPDATE public.jobs
    SET status='accepted', driver_id=_bid.driver_id, accepted_bid_id=_bid_id, final_price=_bid.price
    WHERE id=_job.id
    RETURNING * INTO _job;
  RETURN _job;
END $$;
GRANT EXECUTE ON FUNCTION public.accept_bid(UUID) TO authenticated;

-- Complete a job: deduct commission from driver wallet
CREATE OR REPLACE FUNCTION public.complete_job(_job_id UUID) RETURNS public.jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _job public.jobs; _rate NUMERIC; _commission NUMERIC; _new_bal NUMERIC;
BEGIN
  SELECT * INTO _job FROM public.jobs WHERE id=_job_id;
  IF _job IS NULL THEN RAISE EXCEPTION 'Job not found'; END IF;
  IF _job.customer_id <> auth.uid() THEN RAISE EXCEPTION 'Only the customer can confirm completion'; END IF;
  IF _job.status NOT IN ('accepted','in_progress') THEN RAISE EXCEPTION 'Job not in progress'; END IF;

  SELECT (value::text)::numeric INTO _rate FROM public.system_settings WHERE key='commission_rate';
  _commission := ROUND(_job.final_price * _rate / 100.0, 2);

  -- Deduct from driver wallet (allow negative; mark limited)
  UPDATE public.wallets SET balance = balance - _commission, updated_at=now()
    WHERE user_id=_job.driver_id RETURNING balance INTO _new_bal;
  UPDATE public.wallets SET limited = (_new_bal < _commission) WHERE user_id=_job.driver_id;

  INSERT INTO public.wallet_transactions(user_id,type,amount,balance_after,job_id,note,created_by)
  VALUES (_job.driver_id,'commission',-_commission,_new_bal,_job.id,
          format('Commission %s%% on job', _rate), auth.uid());

  UPDATE public.driver_profiles SET jobs_completed = jobs_completed + 1 WHERE user_id=_job.driver_id;

  UPDATE public.jobs SET status='completed', commission=_commission WHERE id=_job_id RETURNING * INTO _job;
  RETURN _job;
END $$;
GRANT EXECUTE ON FUNCTION public.complete_job(UUID) TO authenticated;

-- Rating aggregate update
CREATE OR REPLACE FUNCTION public.tg_rating_aggregate() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE _avg NUMERIC; _cnt INT;
BEGIN
  SELECT ROUND(AVG((quality+communication+reliability+delivery_time)/4.0)::numeric,2), COUNT(*)
    INTO _avg, _cnt FROM public.ratings WHERE driver_id=NEW.driver_id;
  UPDATE public.driver_profiles SET rating_avg=_avg, rating_count=_cnt WHERE user_id=NEW.driver_id;
  RETURN NEW;
END $$;
CREATE TRIGGER t_rating_agg AFTER INSERT ON public.ratings FOR EACH ROW EXECUTE FUNCTION public.tg_rating_aggregate();

-- Realtime for messages
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.bids;
ALTER PUBLICATION supabase_realtime ADD TABLE public.jobs;
