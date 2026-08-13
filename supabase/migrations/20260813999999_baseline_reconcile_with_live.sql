-- =============================================================================
-- BASELINE: reconcile git migration history with the live database
-- =============================================================================
--
-- Context (13/08/2026): git's migration history in supabase/migrations/ is
-- INCOMPLETE. Multiple sessions applied migrations directly to the live
-- Supabase project (ovwrsocjmkpiygipmrdk) without ever committing the
-- corresponding .sql file. The drift includes, but is not limited to:
--
--   - ~46 migrations applied live between 01/08/2026 and 11/08/2026 that
--     have no .sql file in this repo at all (escrow payments, driver level
--     perks, chat voice/media, web push infrastructure, the signup
--     privilege-escalation fix, account deletion support, and more).
--   - 0030_load_size_price_bands — created material_price_buckets, live-only.
--   - A second, later 0033 migration
--     (fix_budget_validation_via_compute_material_offer) applied ~3 minutes
--     after the committed 0033, live-only.
--   - 0034b_recreate_admin_set_diesel_price — recreated admin_set_diesel_price
--     after it was found missing live, live-only.
--   - drop_legacy_admin_set_material_price_text_overload — live-only.
--   - restrict_admin_from_settings_and_topups — live-only.
--
-- Rather than reconstruct 46+ missing migration files individually (their
-- exact original SQL and ordering is not recoverable with confidence), this
-- migration is a SNAPSHOT of the live schema as introspected from
-- ovwrsocjmkpiygipmrdk on 13/08/2026: every table, column, constraint,
-- index, function, trigger, view, RLS policy, and table grant in the
-- `public` schema, exactly as it stands live. Applying this file to a fresh
-- database brings it to the same schema git now describes; applying it to
-- the live database (where every one of these objects already exists) is a
-- no-op — every statement is written defensively (IF NOT EXISTS, CREATE OR
-- REPLACE, or a DO block swallowing duplicate_object) so it does not error
-- either way. It intentionally does not attempt to reproduce the history of
-- *how* the schema got here, only *what* it is now — that history is not
-- reliably recoverable after the fact.
--
-- Everything below is generated from live pg_catalog / information_schema
-- introspection on 13/08/2026, not hand-written.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Extensions
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;


-- -----------------------------------------------------------------------------
-- Enum types
-- -----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.account_status AS ENUM ('active', 'suspended', 'banned');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('customer', 'driver', 'admin', 'super_admin');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.bid_status AS ENUM ('pending', 'accepted', 'rejected', 'withdrawn');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.dispatch_offer_status AS ENUM ('pending', 'accepted', 'expired', 'superseded', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.dispute_category AS ENUM ('wrong_quantity', 'damage', 'no_show', 'payment_issue', 'conduct', 'other');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.dispute_outcome AS ENUM ('refund', 'fee_waived', 'strike_issued', 'no_action', 'account_suspended');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.dispute_status AS ENUM ('open', 'investigating', 'resolved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.driver_level AS ENUM ('bronze', 'silver', 'gold', 'platinum');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.job_status AS ENUM ('open', 'accepted', 'in_progress', 'completed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.material_category AS ENUM ('river_sand', 'pit_sand', 'quarry_dust', 'crusher_run', 'gravel', 'stones', 'top_soil', 'filling_soil', 'custom');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.tx_type AS ENUM ('topup', 'commission', 'refund', 'adjustment', 'withdrawal');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.verification_status AS ENUM ('pending', 'verified', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_audit_log (id uuid DEFAULT gen_random_uuid() NOT NULL,

  actor_id uuid NOT NULL,

  action text NOT NULL,

  target_user_id uuid,

  target_id uuid,

  reason text,

  meta jsonb DEFAULT '{}'::jsonb NOT NULL,

  created_at timestamp with time zone DEFAULT now() NOT NULL);

CREATE TABLE IF NOT EXISTS public.bids (id uuid DEFAULT gen_random_uuid() NOT NULL,

  job_id uuid NOT NULL,

  driver_id uuid NOT NULL,

  price numeric(10,2) NOT NULL,

  delivery_date date,

  message text,

  status bid_status DEFAULT 'pending'::bid_status NOT NULL,

  created_at timestamp with time zone DEFAULT now() NOT NULL,

  customer_counter_price numeric,

  counter_status text DEFAULT 'none'::text NOT NULL);

CREATE TABLE IF NOT EXISTS public.cancellation_events (id uuid DEFAULT gen_random_uuid() NOT NULL,

  user_id uuid NOT NULL,

  job_id uuid,

  role text NOT NULL,

  stage text NOT NULL,

  reason text,

  created_at timestamp with time zone DEFAULT now() NOT NULL,

  waived_at timestamp with time zone,

  waived_by uuid,

  waive_reason text);

CREATE TABLE IF NOT EXISTS public.chat_flags (id uuid DEFAULT gen_random_uuid() NOT NULL,

  message_id uuid NOT NULL,

  job_id uuid NOT NULL,

  sender_id uuid NOT NULL,

  pattern_type text NOT NULL,

  snippet text,

  created_at timestamp with time zone DEFAULT now() NOT NULL);

CREATE TABLE IF NOT EXISTS public.conversation_members (conversation_id uuid NOT NULL,

  user_id uuid NOT NULL,

  role text DEFAULT 'member'::text NOT NULL,

  joined_at timestamp with time zone DEFAULT now() NOT NULL);

CREATE TABLE IF NOT EXISTS public.conversation_messages (id uuid DEFAULT gen_random_uuid() NOT NULL,

  conversation_id uuid NOT NULL,

  sender_id uuid NOT NULL,

  body text NOT NULL,

  sent_at timestamp with time zone DEFAULT now() NOT NULL,

  edited_at timestamp with time zone);

CREATE TABLE IF NOT EXISTS public.conversations (id uuid DEFAULT gen_random_uuid() NOT NULL,

  created_by uuid NOT NULL,

  created_at timestamp with time zone DEFAULT now() NOT NULL);

CREATE TABLE IF NOT EXISTS public.customer_ratings (id uuid DEFAULT gen_random_uuid() NOT NULL,

  job_id uuid NOT NULL,

  driver_id uuid NOT NULL,

  customer_id uuid NOT NULL,

  punctuality integer NOT NULL,

  communication integer NOT NULL,

  payment integer NOT NULL,

  overall integer NOT NULL,

  comment text,

  created_at timestamp with time zone DEFAULT now() NOT NULL);

CREATE TABLE IF NOT EXISTS public.disputes (id uuid DEFAULT gen_random_uuid() NOT NULL,

  job_id uuid NOT NULL,

  raised_by uuid NOT NULL,

  against uuid,

  reason text NOT NULL,

  status dispute_status DEFAULT 'open'::dispute_status NOT NULL,

  resolution text,

  resolved_by uuid,

  resolved_at timestamp with time zone,

  created_at timestamp with time zone DEFAULT now() NOT NULL,

  category dispute_category DEFAULT 'other'::dispute_category NOT NULL,

  outcome dispute_outcome,

  review_due_at timestamp with time zone,

  escalated_at timestamp with time zone);

CREATE TABLE IF NOT EXISTS public.driver_locations (job_id uuid NOT NULL,

  driver_id uuid NOT NULL,

  lat double precision NOT NULL,

  lng double precision NOT NULL,

  heading double precision,

  accuracy double precision,

  updated_at timestamp with time zone DEFAULT now() NOT NULL,

  stationary_since timestamp with time zone,

  anomaly_alerted_at timestamp with time zone);

CREATE TABLE IF NOT EXISTS public.driver_profiles (user_id uuid NOT NULL,

  national_id text,

  national_id_url text,

  selfie_url text,

  verification_status verification_status DEFAULT 'pending'::verification_status NOT NULL,

  verification_notes text,

  level driver_level DEFAULT 'bronze'::driver_level NOT NULL,

  rating_avg numeric(3,2) DEFAULT 0 NOT NULL,

  rating_count integer DEFAULT 0 NOT NULL,

  jobs_completed integer DEFAULT 0 NOT NULL,

  created_at timestamp with time zone DEFAULT now() NOT NULL,

  updated_at timestamp with time zone DEFAULT now() NOT NULL,

  first_job_free_used boolean DEFAULT false NOT NULL,

  withdrawal_pin_hash text,

  license_url text,

  tipper_photo_url text,

  nationality text,

  operator_license_url text,

  certificate_of_fitness_url text,

  git_insurance_url text,

  zinara_url text,

  verified_at timestamp with time zone,

  reverify_due_at timestamp with time zone,

  tipper_photo_side_url text,

  tipper_photo_back_url text);

CREATE TABLE IF NOT EXISTS public.evidence_access_log (id uuid DEFAULT gen_random_uuid() NOT NULL,

  evidence_id uuid,

  job_id uuid,

  viewer_id uuid NOT NULL,

  purpose text,

  created_at timestamp with time zone DEFAULT now() NOT NULL);

CREATE TABLE IF NOT EXISTS public.job_dispatch_offers (id uuid DEFAULT gen_random_uuid() NOT NULL,

  job_id uuid NOT NULL,

  driver_id uuid NOT NULL,

  wave integer DEFAULT 1 NOT NULL,

  status dispatch_offer_status DEFAULT 'pending'::dispatch_offer_status NOT NULL,

  offered_at timestamp with time zone DEFAULT now() NOT NULL,

  expires_at timestamp with time zone DEFAULT (now() + '00:00:10'::interval) NOT NULL,

  responded_at timestamp with time zone,

  created_at timestamp with time zone DEFAULT now() NOT NULL);

CREATE TABLE IF NOT EXISTS public.job_evidence (id uuid DEFAULT gen_random_uuid() NOT NULL,

  job_id uuid NOT NULL,

  kind text NOT NULL,

  storage_path text NOT NULL,

  uploaded_by uuid NOT NULL,

  uploaded_at timestamp with time zone DEFAULT now() NOT NULL,

  file_size bigint,

  mime_type text,

  device_lat double precision,

  device_lng double precision,

  device_accuracy_m numeric(8,1),

  location_status text DEFAULT 'unknown'::text NOT NULL,

  superseded_by uuid,

  superseded_at timestamp with time zone,

  notes text);

CREATE TABLE IF NOT EXISTS public.jobs (id uuid DEFAULT gen_random_uuid() NOT NULL,

  customer_id uuid NOT NULL,

  driver_id uuid,

  material material_category NOT NULL,

  custom_material text,

  quantity_m3 numeric(8,2) NOT NULL,

  delivery_address text NOT NULL,

  budget numeric(10,2) NOT NULL,

  preferred_date date,

  notes text,

  status job_status DEFAULT 'open'::job_status NOT NULL,

  accepted_bid_id uuid,

  final_price numeric(10,2),

  commission numeric(10,2),

  created_at timestamp with time zone DEFAULT now() NOT NULL,

  updated_at timestamp with time zone DEFAULT now() NOT NULL,

  expires_at timestamp with time zone DEFAULT (now() + '48:00:00'::interval),

  pickup_lat double precision,

  pickup_lng double precision,

  pickup_address text,

  delivery_lat double precision,

  delivery_lng double precision,

  tracking_token uuid DEFAULT gen_random_uuid() NOT NULL,

  cancellation_reason text,

  cancellation_stage text,

  cancelled_at timestamp with time zone,

  cancelled_by uuid,

  held_commission numeric(14,2),

  pickup_photo_url text,

  delivery_photo_url text,

  pickup_photo_taken_at timestamp with time zone,

  delivery_photo_taken_at timestamp with time zone,

  delivered_quantity_m3 numeric(10,2),

  receiver_name text,

  completed_at timestamp with time zone,

  dropoff_lat double precision,

  dropoff_lng double precision,

  dropoff_address text,

  preferred_driver_id uuid,

  payment_method text DEFAULT 'direct'::text NOT NULL,

  delivery_pin text);

CREATE TABLE IF NOT EXISTS public.location_anomalies (id uuid DEFAULT gen_random_uuid() NOT NULL,

  job_id uuid NOT NULL,

  driver_id uuid NOT NULL,

  kind text NOT NULL,

  lat double precision NOT NULL,

  lng double precision NOT NULL,

  stationary_minutes integer NOT NULL,

  created_at timestamp with time zone DEFAULT now() NOT NULL);

CREATE TABLE IF NOT EXISTS public.material_price_buckets (material material_category NOT NULL,

  bucket_m3 integer NOT NULL,

  min_price numeric NOT NULL,

  max_price numeric NOT NULL,

  updated_at timestamp with time zone DEFAULT now() NOT NULL,

  updated_by uuid);

CREATE TABLE IF NOT EXISTS public.material_prices (material material_category NOT NULL,

  label text NOT NULL,

  min_price numeric(12,2) NOT NULL,

  max_price numeric(12,2) NOT NULL,

  unit text DEFAULT '10-15 m³ load'::text NOT NULL,

  enforced boolean DEFAULT true NOT NULL,

  updated_at timestamp with time zone DEFAULT now() NOT NULL,

  updated_by uuid,

  demand_multiplier numeric DEFAULT 1.0 NOT NULL,

  pickup_lat numeric,

  pickup_lng numeric,

  pickup_label text);

CREATE TABLE IF NOT EXISTS public.messages (id uuid DEFAULT gen_random_uuid() NOT NULL,

  job_id uuid NOT NULL,

  sender_id uuid NOT NULL,

  body text,

  image_url text,

  created_at timestamp with time zone DEFAULT now() NOT NULL,

  read_at timestamp with time zone,

  audio_url text,

  audio_duration_seconds integer);

CREATE TABLE IF NOT EXISTS public.notifications (id uuid DEFAULT gen_random_uuid() NOT NULL,

  user_id uuid NOT NULL,

  type text NOT NULL,

  title text NOT NULL,

  body text,

  job_id uuid,

  read boolean DEFAULT false NOT NULL,

  created_at timestamp with time zone DEFAULT now() NOT NULL);

CREATE TABLE IF NOT EXISTS public.payments (id uuid DEFAULT gen_random_uuid() NOT NULL,

  user_id uuid NOT NULL,

  job_id uuid,

  type text NOT NULL,

  amount numeric(12,2) NOT NULL,

  currency text DEFAULT 'USD'::text NOT NULL,

  method text,

  paynow_reference text,

  paynow_poll_url text,

  status text DEFAULT 'initiated'::text NOT NULL,

  created_at timestamp with time zone DEFAULT now() NOT NULL,

  updated_at timestamp with time zone DEFAULT now() NOT NULL);

CREATE TABLE IF NOT EXISTS public.pin_attempts (user_id uuid NOT NULL,

  fail_count integer DEFAULT 0 NOT NULL,

  locked_until timestamp with time zone,

  updated_at timestamp with time zone DEFAULT now() NOT NULL);

CREATE TABLE IF NOT EXISTS public.profiles (id uuid NOT NULL,

  full_name text NOT NULL,

  phone text,

  email text,

  avatar_url text,

  status account_status DEFAULT 'active'::account_status NOT NULL,

  created_at timestamp with time zone DEFAULT now() NOT NULL,

  updated_at timestamp with time zone DEFAULT now() NOT NULL,

  cancellation_strikes integer DEFAULT 0 NOT NULL,

  restricted_until timestamp with time zone,

  restriction_reason text,

  terms_accepted_at timestamp with time zone,

  customer_rating_avg numeric,

  customer_rating_count integer DEFAULT 0 NOT NULL,

  deleted_at timestamp with time zone,

  onboarding_completed_at timestamp with time zone,

  spotlights_seen jsonb DEFAULT '{}'::jsonb NOT NULL,

  last_active_at timestamp with time zone);

CREATE TABLE IF NOT EXISTS public.push_subscriptions (id uuid DEFAULT gen_random_uuid() NOT NULL,

  user_id uuid NOT NULL,

  endpoint text NOT NULL,

  p256dh text NOT NULL,

  auth text NOT NULL,

  created_at timestamp with time zone DEFAULT now() NOT NULL);

CREATE TABLE IF NOT EXISTS public.ratings (id uuid DEFAULT gen_random_uuid() NOT NULL,

  job_id uuid NOT NULL,

  customer_id uuid NOT NULL,

  driver_id uuid NOT NULL,

  quality integer NOT NULL,

  communication integer NOT NULL,

  reliability integer NOT NULL,

  delivery_time integer NOT NULL,

  comment text,

  created_at timestamp with time zone DEFAULT now() NOT NULL);

CREATE TABLE IF NOT EXISTS public.reports (id uuid DEFAULT gen_random_uuid() NOT NULL,

  user_id uuid NOT NULL,

  job_id uuid,

  description text NOT NULL,

  status text DEFAULT 'open'::text NOT NULL,

  admin_notes text,

  created_at timestamp with time zone DEFAULT now() NOT NULL);

CREATE TABLE IF NOT EXISTS public.system_settings (key text NOT NULL,

  value jsonb NOT NULL,

  updated_at timestamp with time zone DEFAULT now() NOT NULL,

  updated_by uuid);

CREATE TABLE IF NOT EXISTS public.thread_summaries (conversation_id uuid NOT NULL,

  summary text NOT NULL,

  summary_prompt jsonb DEFAULT '{}'::jsonb NOT NULL,

  summarized_at timestamp with time zone DEFAULT now() NOT NULL,

  updated_at timestamp with time zone DEFAULT now() NOT NULL);

CREATE TABLE IF NOT EXISTS public.trucks (id uuid DEFAULT gen_random_uuid() NOT NULL,

  driver_id uuid NOT NULL,

  registration text NOT NULL,

  capacity_m3 numeric(6,2) NOT NULL,

  photo_url text,

  created_at timestamp with time zone DEFAULT now() NOT NULL);

CREATE TABLE IF NOT EXISTS public.user_hints_seen (user_id uuid NOT NULL,

  hint_id text NOT NULL,

  seen_at timestamp with time zone DEFAULT now() NOT NULL);

CREATE TABLE IF NOT EXISTS public.user_roles (id uuid DEFAULT gen_random_uuid() NOT NULL,

  user_id uuid NOT NULL,

  role app_role NOT NULL,

  created_at timestamp with time zone DEFAULT now() NOT NULL);

CREATE TABLE IF NOT EXISTS public.wallet_audit_log (id uuid DEFAULT gen_random_uuid() NOT NULL,

  user_id uuid NOT NULL,

  actor_id uuid,

  action text NOT NULL,

  meta jsonb DEFAULT '{}'::jsonb NOT NULL,

  created_at timestamp with time zone DEFAULT now() NOT NULL);

CREATE TABLE IF NOT EXISTS public.wallet_topup_requests (id uuid DEFAULT gen_random_uuid() NOT NULL,

  user_id uuid NOT NULL,

  amount numeric(12,2) NOT NULL,

  method text NOT NULL,

  reference text,

  note text,

  status text DEFAULT 'pending'::text NOT NULL,

  reject_reason text,

  decided_by uuid,

  decided_at timestamp with time zone,

  created_at timestamp with time zone DEFAULT now() NOT NULL);

CREATE TABLE IF NOT EXISTS public.wallet_transactions (id uuid DEFAULT gen_random_uuid() NOT NULL,

  user_id uuid NOT NULL,

  type tx_type NOT NULL,

  amount numeric(12,2) NOT NULL,

  balance_after numeric(12,2) NOT NULL,

  job_id uuid,

  note text,

  created_by uuid,

  created_at timestamp with time zone DEFAULT now() NOT NULL);

CREATE TABLE IF NOT EXISTS public.wallet_withdrawal_requests (id uuid DEFAULT gen_random_uuid() NOT NULL,

  user_id uuid NOT NULL,

  amount numeric(12,2) NOT NULL,

  method text NOT NULL,

  destination text NOT NULL,

  note text,

  status text DEFAULT 'pending'::text NOT NULL,

  reject_reason text,

  decided_by uuid,

  decided_at timestamp with time zone,

  created_at timestamp with time zone DEFAULT now() NOT NULL);

CREATE TABLE IF NOT EXISTS public.wallets (user_id uuid NOT NULL,

  balance numeric(12,2) DEFAULT 0 NOT NULL,

  limited boolean DEFAULT false NOT NULL,

  updated_at timestamp with time zone DEFAULT now() NOT NULL,

  held numeric(14,2) DEFAULT 0 NOT NULL);


-- -----------------------------------------------------------------------------
-- Primary key constraints
-- -----------------------------------------------------------------------------
DO $$ BEGIN
  ALTER TABLE ONLY public.admin_audit_log ADD CONSTRAINT admin_audit_log_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.bids ADD CONSTRAINT bids_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.cancellation_events ADD CONSTRAINT cancellation_events_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.chat_flags ADD CONSTRAINT chat_flags_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.conversation_members ADD CONSTRAINT conversation_members_pkey PRIMARY KEY (conversation_id, user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.conversation_messages ADD CONSTRAINT conversation_messages_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.conversations ADD CONSTRAINT conversations_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.customer_ratings ADD CONSTRAINT customer_ratings_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.disputes ADD CONSTRAINT disputes_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.driver_locations ADD CONSTRAINT driver_locations_pkey PRIMARY KEY (job_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.driver_profiles ADD CONSTRAINT driver_profiles_pkey PRIMARY KEY (user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.evidence_access_log ADD CONSTRAINT evidence_access_log_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.job_dispatch_offers ADD CONSTRAINT job_dispatch_offers_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.job_evidence ADD CONSTRAINT job_evidence_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.jobs ADD CONSTRAINT jobs_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.location_anomalies ADD CONSTRAINT location_anomalies_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.material_price_buckets ADD CONSTRAINT material_price_buckets_pkey PRIMARY KEY (material, bucket_m3);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.material_prices ADD CONSTRAINT material_prices_pkey PRIMARY KEY (material);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.messages ADD CONSTRAINT messages_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.notifications ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.payments ADD CONSTRAINT payments_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.pin_attempts ADD CONSTRAINT pin_attempts_pkey PRIMARY KEY (user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.profiles ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.push_subscriptions ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.ratings ADD CONSTRAINT ratings_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.reports ADD CONSTRAINT reports_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.system_settings ADD CONSTRAINT system_settings_pkey PRIMARY KEY (key);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.thread_summaries ADD CONSTRAINT thread_summaries_pkey PRIMARY KEY (conversation_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.trucks ADD CONSTRAINT trucks_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.user_hints_seen ADD CONSTRAINT user_hints_seen_pkey PRIMARY KEY (user_id, hint_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.user_roles ADD CONSTRAINT user_roles_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.wallet_audit_log ADD CONSTRAINT wallet_audit_log_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.wallet_topup_requests ADD CONSTRAINT wallet_topup_requests_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.wallet_transactions ADD CONSTRAINT wallet_transactions_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.wallet_withdrawal_requests ADD CONSTRAINT wallet_withdrawal_requests_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.wallets ADD CONSTRAINT wallets_pkey PRIMARY KEY (user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- -----------------------------------------------------------------------------
-- Unique constraints
-- -----------------------------------------------------------------------------
DO $$ BEGIN
  ALTER TABLE ONLY public.bids ADD CONSTRAINT bids_job_id_driver_id_key UNIQUE (job_id, driver_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.customer_ratings ADD CONSTRAINT customer_ratings_job_id_driver_id_key UNIQUE (job_id, driver_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.job_dispatch_offers ADD CONSTRAINT job_dispatch_offers_job_id_driver_id_key UNIQUE (job_id, driver_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.job_evidence ADD CONSTRAINT job_evidence_storage_path_key UNIQUE (storage_path);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.push_subscriptions ADD CONSTRAINT push_subscriptions_endpoint_key UNIQUE (endpoint);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.ratings ADD CONSTRAINT ratings_job_id_key UNIQUE (job_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.user_roles ADD CONSTRAINT user_roles_user_id_role_key UNIQUE (user_id, role);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- -----------------------------------------------------------------------------
-- Check constraints
-- -----------------------------------------------------------------------------
DO $$ BEGIN
  ALTER TABLE ONLY public.bids ADD CONSTRAINT bids_counter_status_check CHECK ((counter_status = ANY (ARRAY['none'::text, 'countered'::text, 'driver_accepted'::text, 'driver_rejected'::text])));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.cancellation_events ADD CONSTRAINT cancellation_events_role_check CHECK ((role = ANY (ARRAY['customer'::text, 'driver'::text])));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.conversation_members ADD CONSTRAINT conversation_members_role_check CHECK ((role = ANY (ARRAY['member'::text, 'admin'::text])));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.customer_ratings ADD CONSTRAINT customer_ratings_communication_check CHECK (((communication >= 1) AND (communication <= 5)));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.customer_ratings ADD CONSTRAINT customer_ratings_overall_check CHECK (((overall >= 1) AND (overall <= 5)));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.customer_ratings ADD CONSTRAINT customer_ratings_payment_check CHECK (((payment >= 1) AND (payment <= 5)));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.customer_ratings ADD CONSTRAINT customer_ratings_punctuality_check CHECK (((punctuality >= 1) AND (punctuality <= 5)));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.job_evidence ADD CONSTRAINT job_evidence_kind_check CHECK ((kind = ANY (ARRAY['pickup'::text, 'delivery'::text, 'dispute'::text, 'other'::text])));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.job_evidence ADD CONSTRAINT job_evidence_location_status_check CHECK ((location_status = ANY (ARRAY['captured'::text, 'denied'::text, 'unavailable'::text, 'timeout'::text, 'unknown'::text])));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.jobs ADD CONSTRAINT jobs_payment_method_check CHECK ((payment_method = ANY (ARRAY['direct'::text, 'escrow'::text])));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.material_price_buckets ADD CONSTRAINT material_price_buckets_bucket_m3_check CHECK ((bucket_m3 > 0));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.material_price_buckets ADD CONSTRAINT material_price_buckets_check CHECK ((max_price >= min_price));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.material_price_buckets ADD CONSTRAINT material_price_buckets_min_price_check CHECK ((min_price >= (0)::numeric));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.material_prices ADD CONSTRAINT material_prices_sane CHECK (((min_price >= (0)::numeric) AND (max_price >= min_price) AND (demand_multiplier > (0)::numeric) AND (demand_multiplier <= 3.0)));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.payments ADD CONSTRAINT payments_amount_check CHECK ((amount > (0)::numeric));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.payments ADD CONSTRAINT payments_status_check CHECK ((status = ANY (ARRAY['initiated'::text, 'paid'::text, 'cancelled'::text, 'failed'::text, 'refunded'::text])));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.payments ADD CONSTRAINT payments_type_check CHECK ((type = ANY (ARRAY['topup'::text, 'job_payment'::text, 'withdrawal'::text, 'escrow'::text])));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.ratings ADD CONSTRAINT ratings_communication_check CHECK (((communication >= 1) AND (communication <= 5)));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.ratings ADD CONSTRAINT ratings_delivery_time_check CHECK (((delivery_time >= 1) AND (delivery_time <= 5)));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.ratings ADD CONSTRAINT ratings_quality_check CHECK (((quality >= 1) AND (quality <= 5)));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.ratings ADD CONSTRAINT ratings_reliability_check CHECK (((reliability >= 1) AND (reliability <= 5)));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.wallet_topup_requests ADD CONSTRAINT wallet_topup_requests_amount_check CHECK (((amount > (0)::numeric) AND (amount <= (100000)::numeric)));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.wallet_topup_requests ADD CONSTRAINT wallet_topup_requests_method_check CHECK ((method = ANY (ARRAY['ecocash'::text, 'onemoney'::text, 'zipit'::text, 'bank'::text])));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.wallet_topup_requests ADD CONSTRAINT wallet_topup_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'cancelled'::text])));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.wallet_withdrawal_requests ADD CONSTRAINT wallet_withdrawal_requests_amount_check CHECK (((amount > (0)::numeric) AND (amount <= (100000)::numeric)));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.wallet_withdrawal_requests ADD CONSTRAINT wallet_withdrawal_requests_method_check CHECK ((method = ANY (ARRAY['ecocash'::text, 'onemoney'::text, 'zipit'::text, 'bank'::text])));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.wallet_withdrawal_requests ADD CONSTRAINT wallet_withdrawal_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'cancelled'::text])));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- -----------------------------------------------------------------------------
-- Foreign key constraints
-- -----------------------------------------------------------------------------
DO $$ BEGIN
  ALTER TABLE ONLY public.bids ADD CONSTRAINT bids_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.bids ADD CONSTRAINT bids_job_id_fkey FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.cancellation_events ADD CONSTRAINT cancellation_events_job_id_fkey FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.chat_flags ADD CONSTRAINT chat_flags_job_id_fkey FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.chat_flags ADD CONSTRAINT chat_flags_message_id_fkey FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.conversation_members ADD CONSTRAINT conversation_members_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.conversation_members ADD CONSTRAINT conversation_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.conversation_messages ADD CONSTRAINT conversation_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.conversation_messages ADD CONSTRAINT conversation_messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES auth.users(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.conversations ADD CONSTRAINT conversations_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.customer_ratings ADD CONSTRAINT customer_ratings_job_id_fkey FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.disputes ADD CONSTRAINT disputes_against_fkey FOREIGN KEY (against) REFERENCES auth.users(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.disputes ADD CONSTRAINT disputes_job_id_fkey FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.disputes ADD CONSTRAINT disputes_raised_by_fkey FOREIGN KEY (raised_by) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.disputes ADD CONSTRAINT disputes_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES auth.users(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.driver_locations ADD CONSTRAINT driver_locations_job_id_fkey FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.driver_profiles ADD CONSTRAINT driver_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.evidence_access_log ADD CONSTRAINT evidence_access_log_evidence_id_fkey FOREIGN KEY (evidence_id) REFERENCES job_evidence(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.job_dispatch_offers ADD CONSTRAINT job_dispatch_offers_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.job_dispatch_offers ADD CONSTRAINT job_dispatch_offers_job_id_fkey FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.job_evidence ADD CONSTRAINT job_evidence_job_id_fkey FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.job_evidence ADD CONSTRAINT job_evidence_superseded_by_fkey FOREIGN KEY (superseded_by) REFERENCES job_evidence(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.jobs ADD CONSTRAINT jobs_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.jobs ADD CONSTRAINT jobs_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES auth.users(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.location_anomalies ADD CONSTRAINT location_anomalies_job_id_fkey FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.material_price_buckets ADD CONSTRAINT material_price_buckets_material_fkey FOREIGN KEY (material) REFERENCES material_prices(material);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.messages ADD CONSTRAINT messages_job_id_fkey FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.messages ADD CONSTRAINT messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.notifications ADD CONSTRAINT notifications_job_id_fkey FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.notifications ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.payments ADD CONSTRAINT payments_job_id_fkey FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.payments ADD CONSTRAINT payments_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.pin_attempts ADD CONSTRAINT pin_attempts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.profiles ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.ratings ADD CONSTRAINT ratings_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.ratings ADD CONSTRAINT ratings_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.ratings ADD CONSTRAINT ratings_job_id_fkey FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.reports ADD CONSTRAINT reports_job_id_fkey FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.reports ADD CONSTRAINT reports_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.system_settings ADD CONSTRAINT system_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.thread_summaries ADD CONSTRAINT thread_summaries_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.trucks ADD CONSTRAINT trucks_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.user_roles ADD CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.wallet_topup_requests ADD CONSTRAINT wallet_topup_requests_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES auth.users(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.wallet_topup_requests ADD CONSTRAINT wallet_topup_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.wallet_transactions ADD CONSTRAINT wallet_transactions_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.wallet_transactions ADD CONSTRAINT wallet_transactions_job_id_fkey FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.wallet_transactions ADD CONSTRAINT wallet_transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.wallet_withdrawal_requests ADD CONSTRAINT wallet_withdrawal_requests_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES auth.users(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.wallet_withdrawal_requests ADD CONSTRAINT wallet_withdrawal_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.wallets ADD CONSTRAINT wallets_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- -----------------------------------------------------------------------------
-- Indexes (non-constraint)
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS admin_audit_log_created_idx ON public.admin_audit_log USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_log_target_idx ON public.admin_audit_log USING btree (target_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bids_driver ON public.bids USING btree (driver_id);
CREATE INDEX IF NOT EXISTS idx_bids_job ON public.bids USING btree (job_id);
CREATE INDEX IF NOT EXISTS cancellation_events_user_idx ON public.cancellation_events USING btree (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS conversation_members_conversation_id_idx ON public.conversation_members USING btree (conversation_id);
CREATE INDEX IF NOT EXISTS conversation_members_user_id_idx ON public.conversation_members USING btree (user_id);
CREATE INDEX IF NOT EXISTS conversation_messages_conversation_id_sent_at_idx ON public.conversation_messages USING btree (conversation_id, sent_at);
CREATE UNIQUE INDEX IF NOT EXISTS customer_ratings_one_per_job ON public.customer_ratings USING btree (job_id);
CREATE INDEX IF NOT EXISTS evidence_access_job_idx ON public.evidence_access_log USING btree (job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jdo_driver_pending ON public.job_dispatch_offers USING btree (driver_id, status) WHERE (status = 'pending'::dispatch_offer_status);
CREATE INDEX IF NOT EXISTS idx_jdo_job ON public.job_dispatch_offers USING btree (job_id);
CREATE INDEX IF NOT EXISTS job_evidence_job_idx ON public.job_evidence USING btree (job_id, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_customer ON public.jobs USING btree (customer_id);
CREATE INDEX IF NOT EXISTS idx_jobs_driver ON public.jobs USING btree (driver_id);
CREATE INDEX IF NOT EXISTS idx_jobs_open_expires ON public.jobs USING btree (expires_at) WHERE (status = 'open'::job_status);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON public.jobs USING btree (status);
CREATE UNIQUE INDEX IF NOT EXISTS jobs_tracking_token_key ON public.jobs USING btree (tracking_token);
CREATE INDEX IF NOT EXISTS idx_messages_job ON public.messages USING btree (job_id, created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON public.notifications USING btree (user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS payments_paynow_ref_key ON public.payments USING btree (paynow_reference) WHERE (paynow_reference IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS ratings_one_per_job ON public.ratings USING btree (job_id);
CREATE INDEX IF NOT EXISTS idx_audit_user ON public.wallet_audit_log USING btree (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_topup_status ON public.wallet_topup_requests USING btree (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_topup_user ON public.wallet_topup_requests USING btree (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wtx_user ON public.wallet_transactions USING btree (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wd_status ON public.wallet_withdrawal_requests USING btree (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wd_user ON public.wallet_withdrawal_requests USING btree (user_id, created_at DESC);


-- -----------------------------------------------------------------------------
-- Functions
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_bid(_bid_id uuid)
 RETURNS jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  _bid   public.bids;
  _job   public.jobs;
  _guard jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;

  select * into _bid from public.bids where id = _bid_id for update;
  if not found then raise exception 'Bid not found'; end if;

  select * into _job from public.jobs where id = _bid.job_id for update;
  if not found then raise exception 'Job not found'; end if;

  if _job.customer_id <> auth.uid() then raise exception 'Not your job'; end if;
  if _job.status <> 'open' then raise exception 'Job not open'; end if;
  if _bid.status <> 'pending' then raise exception 'Bid no longer available'; end if;

  update public.bids set status = 'accepted' where id = _bid_id;
  update public.bids set status = 'rejected'
   where job_id = _job.id and id <> _bid_id and status = 'pending';

  update public.jobs
     set status = 'accepted', driver_id = _bid.driver_id,
         accepted_bid_id = _bid_id, final_price = _bid.price
   where id = _job.id
  returning * into _job;

  -- FIX #11: the bid path skipped this guard entirely. Checked
  -- AFTER final_price is set, so the commission is computed on
  -- the real accepted price rather than the budget.
  _guard := public.driver_can_accept_for(_job.id, _bid.driver_id);
  if (_guard->>'ok')::boolean is not true then
    raise exception 'Driver has insufficient wallet balance: needs $%, has $% available',
      _guard->>'required', _guard->>'available';
  end if;

  perform public.hold_job_commission(_job.id);

  update public.job_dispatch_offers
     set status = 'superseded', responded_at = now()
   where job_id = _job.id and status = 'pending';

  return _job;
end $function$
;

CREATE OR REPLACE FUNCTION public.accept_counter(_bid_id uuid)
 RETURNS jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE _bid public.bids; _job public.jobs; _guard jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;

  SELECT * INTO _bid FROM public.bids WHERE id = _bid_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bid not found'; END IF;
  IF _bid.driver_id <> auth.uid() THEN RAISE EXCEPTION 'Not your bid'; END IF;
  IF _bid.status <> 'pending' THEN RAISE EXCEPTION 'Bid no longer available'; END IF;
  IF _bid.counter_status <> 'countered' THEN RAISE EXCEPTION 'No pending counter-offer on this bid'; END IF;

  SELECT * INTO _job FROM public.jobs WHERE id = _bid.job_id FOR UPDATE;
  IF _job.status <> 'open' THEN RAISE EXCEPTION 'Job not open'; END IF;

  UPDATE public.bids SET price = _bid.customer_counter_price, status = 'accepted', counter_status = 'driver_accepted'
   WHERE id = _bid_id;
  UPDATE public.bids SET status = 'rejected'
   WHERE job_id = _job.id AND id <> _bid_id AND status = 'pending';

  UPDATE public.jobs
     SET status = 'accepted', driver_id = _bid.driver_id,
         accepted_bid_id = _bid_id, final_price = _bid.customer_counter_price
   WHERE id = _job.id
  RETURNING * INTO _job;

  _guard := public.driver_can_accept_for(_job.id, _bid.driver_id);
  IF (_guard->>'ok')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'Insufficient wallet balance: need $%, have $% available',
      _guard->>'required', _guard->>'available';
  END IF;

  PERFORM public.hold_job_commission(_job.id);

  UPDATE public.job_dispatch_offers
     SET status = 'superseded', responded_at = now()
   WHERE job_id = _job.id AND status = 'pending';

  INSERT INTO public.notifications(user_id, type, title, body, job_id)
  VALUES (_job.customer_id, 'bid_accepted', 'Driver accepted your price!',
          format('They agreed to $%s for your %s delivery.', _bid.customer_counter_price::text, _job.material), _job.id);

  RETURN _job;
END $function$
;

CREATE OR REPLACE FUNCTION public.accept_dispatch_offer(_offer_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  offer_row public.job_dispatch_offers%rowtype;
  job_row   public.jobs%rowtype;
  guard     jsonb;
begin
  select * into offer_row from public.job_dispatch_offers
    where id = _offer_id for update;
  if not found then raise exception 'Offer not found'; end if;
  if offer_row.driver_id <> auth.uid() then raise exception 'Not your offer'; end if;
  if offer_row.status <> 'pending' then raise exception 'Offer no longer available'; end if;

  if offer_row.expires_at < now() then
    update public.job_dispatch_offers
       set status = 'expired', responded_at = now() where id = _offer_id;
    raise exception 'Offer expired';
  end if;

  select * into job_row from public.jobs where id = offer_row.job_id for update;
  if job_row.status <> 'open' then raise exception 'Job no longer available'; end if;

  guard := public.driver_can_accept(job_row.id);
  if (guard->>'ok')::boolean is not true then
    raise exception 'Insufficient wallet balance: need $% commission, have $% available',
      guard->>'required', guard->>'available';
  end if;

  update public.jobs
     set driver_id = auth.uid(), status = 'accepted',
         final_price = coalesce(final_price, budget)
   where id = job_row.id;

  perform public.hold_job_commission(job_row.id);

  update public.job_dispatch_offers
     set status = 'accepted', responded_at = now() where id = _offer_id;
  update public.job_dispatch_offers
     set status = 'superseded', responded_at = now()
   where job_id = job_row.id and id <> _offer_id and status = 'pending';

  return job_row.id;
end $function$
;

CREATE OR REPLACE FUNCTION public.admin_approve_topup(_id uuid)
 RETURNS wallets
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _r public.wallet_topup_requests; _new_bal numeric; _w public.wallets;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  SELECT * INTO _r FROM public.wallet_topup_requests WHERE id=_id FOR UPDATE;
  IF _r IS NULL THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF _r.status = 'approved' THEN
    SELECT * INTO _w FROM public.wallets WHERE user_id=_r.user_id; RETURN _w;
  END IF;
  IF _r.status <> 'pending' THEN RAISE EXCEPTION 'Request not pending'; END IF;

  INSERT INTO public.wallets(user_id, balance) VALUES (_r.user_id, 0)
    ON CONFLICT (user_id) DO NOTHING;
  UPDATE public.wallets SET balance = balance + _r.amount, updated_at=now(), limited=false
    WHERE user_id=_r.user_id RETURNING balance INTO _new_bal;

  INSERT INTO public.wallet_transactions(user_id,type,amount,balance_after,note,created_by)
    VALUES (_r.user_id,'topup',_r.amount,_new_bal,
            format('Top-up via %s (ref %s)',_r.method,COALESCE(_r.reference,'—')),
            auth.uid());

  UPDATE public.wallet_topup_requests
    SET status='approved', decided_by=auth.uid(), decided_at=now()
    WHERE id=_id;

  INSERT INTO public.wallet_audit_log(user_id,actor_id,action,meta)
    VALUES (_r.user_id,auth.uid(),'topup_approved',
            jsonb_build_object('id',_id,'amount',_r.amount,'new_balance',_new_bal));

  PERFORM public.log_admin_action('topup_approved', jsonb_build_object('id', _id, 'amount', _r.amount, 'method', _r.method), NULL, _id, _r.user_id);

  INSERT INTO public.notifications(user_id,type,title,body)
    VALUES (_r.user_id,'wallet_topup','Top-up approved',
            format('$%s added to your wallet.',_r.amount::text));

  SELECT * INTO _w FROM public.wallets WHERE user_id=_r.user_id;
  RETURN _w;
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_approve_withdrawal(_id uuid)
 RETURNS wallets
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _r public.wallet_withdrawal_requests; _new_bal numeric; _w public.wallets;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  SELECT * INTO _r FROM public.wallet_withdrawal_requests WHERE id=_id FOR UPDATE;
  IF _r IS NULL OR _r.status <> 'pending' THEN RAISE EXCEPTION 'Not pending'; END IF;

  UPDATE public.wallets SET balance = balance - _r.amount, updated_at=now()
    WHERE user_id=_r.user_id RETURNING balance INTO _new_bal;
  IF _new_bal < 0 THEN RAISE EXCEPTION 'Insufficient balance'; END IF;

  INSERT INTO public.wallet_transactions(user_id,type,amount,balance_after,note,created_by)
    VALUES (_r.user_id,'withdrawal',-_r.amount,_new_bal,
            format('Withdrawal via %s',_r.method), auth.uid());

  UPDATE public.wallet_withdrawal_requests SET status='approved', decided_by=auth.uid(), decided_at=now() WHERE id=_id;

  INSERT INTO public.wallet_audit_log(user_id,actor_id,action,meta)
    VALUES (_r.user_id,auth.uid(),'withdrawal_approved',
            jsonb_build_object('id',_id,'amount',_r.amount,'new_balance',_new_bal));

  PERFORM public.log_admin_action('withdrawal_approved', jsonb_build_object('id', _id, 'amount', _r.amount, 'method', _r.method), NULL, _id, _r.user_id);

  INSERT INTO public.notifications(user_id,type,title,body)
    VALUES (_r.user_id,'wallet_withdrawal','Withdrawal approved',
            format('$%s withdrawn from your wallet.',_r.amount::text));

  SELECT * INTO _w FROM public.wallets WHERE user_id=_r.user_id;
  RETURN _w;
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_credit_wallet(_user_id uuid, _amount numeric, _note text)
 RETURNS wallets
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _new_bal numeric; _w public.wallets;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF _amount = 0 THEN RAISE EXCEPTION 'Amount cannot be zero'; END IF;

  INSERT INTO public.wallets(user_id, balance) VALUES (_user_id, 0)
  ON CONFLICT (user_id) DO NOTHING;

  UPDATE public.wallets SET balance = balance + _amount, updated_at = now()
  WHERE user_id = _user_id RETURNING balance INTO _new_bal;

  UPDATE public.wallets SET limited = (_new_bal < 0) WHERE user_id = _user_id
  RETURNING * INTO _w;

  INSERT INTO public.wallet_transactions(user_id, type, amount, balance_after, note, created_by)
  VALUES (_user_id,
          CASE WHEN _amount > 0 THEN 'topup'::public.tx_type ELSE 'adjustment'::public.tx_type END,
          _amount, _new_bal, COALESCE(_note,'Admin adjustment'), auth.uid());

  PERFORM public.log_admin_action('wallet_credited_by_admin', jsonb_build_object('amount', _amount, 'new_balance', _new_bal, 'note', _note), _note, NULL, _user_id);

  RETURN _w;
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_evidence_paths(_job_id uuid)
 RETURNS TABLE(evidence_id uuid, kind text, storage_path text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  RETURN QUERY SELECT e.id, e.kind, e.storage_path FROM public.job_evidence e WHERE e.job_id = _job_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_grant_role(_user_id uuid, _role app_role, _reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(),'super_admin') THEN
    RAISE EXCEPTION 'Only super admins can grant roles';
  END IF;
  INSERT INTO public.user_roles(user_id, role) VALUES (_user_id, _role) ON CONFLICT DO NOTHING;
  PERFORM public.log_admin_action('role_granted', jsonb_build_object('role', _role), _reason, NULL, _user_id);
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_job_evidence(_job_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare _r jsonb;
begin
  if not (public.has_role(auth.uid(), 'admin'::public.app_role)
       or public.has_role(auth.uid(), 'super_admin'::public.app_role)) then
    raise exception 'Forbidden';
  end if;

  select jsonb_build_object(
    'job', to_jsonb(j) - 'notes',
    'evidence', coalesce((
      select jsonb_agg(to_jsonb(e) order by e.uploaded_at)
      from public.job_evidence e where e.job_id = _job_id), '[]'::jsonb),
    'access_log', coalesce((
      select jsonb_agg(jsonb_build_object(
               'viewer', p.full_name, 'at', a.created_at, 'purpose', a.purpose)
             order by a.created_at desc)
      from public.evidence_access_log a
      left join public.profiles p on p.id = a.viewer_id
      where a.job_id = _job_id), '[]'::jsonb),
    'disputes', coalesce((
      select jsonb_agg(to_jsonb(d) order by d.created_at)
      from public.disputes d where d.job_id = _job_id), '[]'::jsonb),
    'storage_objects', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', o.name, 'size', o.metadata->>'size',
               'created', o.created_at, 'updated', o.updated_at))
      from storage.objects o
      where o.bucket_id = 'job-proof-photos'
        and (storage.foldername(o.name))[1] = _job_id::text), '[]'::jsonb)
  ) into _r
  from public.jobs j where j.id = _job_id;

  return coalesce(_r, jsonb_build_object('error','job_not_found'));
end $function$
;

CREATE OR REPLACE FUNCTION public.admin_job_investigation(_job_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  _job public.jobs;
  _result jsonb;
  _ev record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in required';
  END IF;
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT * INTO _job FROM public.jobs WHERE id = _job_id;
  IF _job IS NULL THEN
    RAISE EXCEPTION 'Job not found';
  END IF;

  FOR _ev IN SELECT id FROM public.job_evidence WHERE job_id = _job_id LOOP
    INSERT INTO public.evidence_access_log(evidence_id, job_id, viewer_id, purpose)
    VALUES (_ev.id, _job_id, auth.uid(), 'admin_investigation');
  END LOOP;

  SELECT jsonb_build_object(
    'job', to_jsonb(_job),
    'customer', (SELECT to_jsonb(p) - 'password' FROM public.profiles p WHERE p.id = _job.customer_id),
    'driver', (SELECT to_jsonb(p) - 'password' FROM public.profiles p WHERE p.id = _job.driver_id),
    'driver_profile', (SELECT to_jsonb(dp) - 'withdrawal_pin_hash' FROM public.driver_profiles dp WHERE dp.user_id = _job.driver_id),
    'evidence', COALESCE((
      SELECT jsonb_agg(to_jsonb(e) ORDER BY e.uploaded_at)
      FROM public.job_evidence e WHERE e.job_id = _job_id
    ), '[]'::jsonb),
    'messages', COALESCE((
      SELECT jsonb_agg(to_jsonb(m) ORDER BY m.created_at)
      FROM public.messages m WHERE m.job_id = _job_id
    ), '[]'::jsonb),
    'bids', COALESCE((
      SELECT jsonb_agg(to_jsonb(b) ORDER BY b.created_at)
      FROM public.bids b WHERE b.job_id = _job_id
    ), '[]'::jsonb),
    'dispatch_offers', COALESCE((
      SELECT jsonb_agg(to_jsonb(o) ORDER BY o.offered_at)
      FROM public.job_dispatch_offers o WHERE o.job_id = _job_id
    ), '[]'::jsonb),
    'cancellation_events', COALESCE((
      SELECT jsonb_agg(to_jsonb(ce) ORDER BY ce.created_at)
      FROM public.cancellation_events ce WHERE ce.job_id = _job_id
    ), '[]'::jsonb),
    'wallet_transactions', COALESCE((
      SELECT jsonb_agg(to_jsonb(wt) ORDER BY wt.created_at)
      FROM public.wallet_transactions wt WHERE wt.job_id = _job_id
    ), '[]'::jsonb),
    'ratings', COALESCE((
      SELECT jsonb_agg(to_jsonb(r)) FROM public.ratings r WHERE r.job_id = _job_id
    ), '[]'::jsonb),
    'customer_ratings', COALESCE((
      SELECT jsonb_agg(to_jsonb(cr)) FROM public.customer_ratings cr WHERE cr.job_id = _job_id
    ), '[]'::jsonb),
    'reports_this_job', COALESCE((
      SELECT jsonb_agg(to_jsonb(rp) ORDER BY rp.created_at)
      FROM public.reports rp WHERE rp.job_id = _job_id
    ), '[]'::jsonb),
    'disputes_this_job', COALESCE((
      SELECT jsonb_agg(to_jsonb(d) ORDER BY d.created_at)
      FROM public.disputes d WHERE d.job_id = _job_id
    ), '[]'::jsonb),
    'disputes_involving_customer', COALESCE((
      SELECT jsonb_agg(to_jsonb(d) ORDER BY d.created_at DESC)
      FROM public.disputes d
      WHERE d.job_id <> _job_id
        AND (d.raised_by = _job.customer_id OR d.against = _job.customer_id)
    ), '[]'::jsonb),
    'disputes_involving_driver', COALESCE((
      SELECT jsonb_agg(to_jsonb(d) ORDER BY d.created_at DESC)
      FROM public.disputes d
      WHERE d.job_id <> _job_id AND _job.driver_id IS NOT NULL
        AND (d.raised_by = _job.driver_id OR d.against = _job.driver_id)
    ), '[]'::jsonb),
    'cancellation_history_customer', COALESCE((
      SELECT jsonb_agg(to_jsonb(ce) ORDER BY ce.created_at DESC)
      FROM public.cancellation_events ce
      WHERE ce.job_id <> _job_id AND ce.user_id = _job.customer_id
    ), '[]'::jsonb),
    'cancellation_history_driver', COALESCE((
      SELECT jsonb_agg(to_jsonb(ce) ORDER BY ce.created_at DESC)
      FROM public.cancellation_events ce
      WHERE ce.job_id <> _job_id AND _job.driver_id IS NOT NULL AND ce.user_id = _job.driver_id
    ), '[]'::jsonb)
  ) INTO _result
  FROM public.jobs j WHERE j.id = _job_id;

  PERFORM public.log_admin_action('job_investigated', '{}'::jsonb, NULL, _job_id, NULL);

  RETURN _result;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_material_price_buckets()
 RETURNS TABLE(material material_category, label text, bucket_m3 integer, min_price numeric, max_price numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT b.material, mp.label, b.bucket_m3, b.min_price, b.max_price
  FROM public.material_price_buckets b
  JOIN public.material_prices mp ON mp.material = b.material
  ORDER BY mp.label, b.bucket_m3;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_material_prices()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare _r jsonb;
begin
  if not (public.has_role(auth.uid(), 'admin'::public.app_role)
       or public.has_role(auth.uid(), 'super_admin'::public.app_role)) then
    raise exception 'Forbidden';
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'material',   mp.material,
      'label',      mp.label,
      'min_price',  mp.min_price,
      'max_price',  mp.max_price,
      'multiplier', mp.demand_multiplier,
      'enforced',   mp.enforced,
      'unit',       mp.unit,
      'updated_at', mp.updated_at,
      'updated_by', p.full_name,
      'pickup_lat', mp.pickup_lat,
      'pickup_lng', mp.pickup_lng,
      'pickup_label', mp.pickup_label,
      'example_offer',
        (public.compute_material_offer(mp.material, 12.5, 15)->>'offer')::numeric
    ) order by mp.enforced desc, mp.label
  ) into _r
  from public.material_prices mp
  left join public.profiles p on p.id = mp.updated_by;

  return coalesce(_r, '[]'::jsonb);
end $function$
;

CREATE OR REPLACE FUNCTION public.admin_reject_topup(_id uuid, _reason text)
 RETURNS wallet_topup_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _r public.wallet_topup_requests;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  UPDATE public.wallet_topup_requests
    SET status='rejected', reject_reason=_reason, decided_by=auth.uid(), decided_at=now()
    WHERE id=_id AND status='pending'
    RETURNING * INTO _r;
  IF _r IS NULL THEN RAISE EXCEPTION 'Cannot reject'; END IF;

  INSERT INTO public.wallet_audit_log(user_id,actor_id,action,meta)
    VALUES (_r.user_id,auth.uid(),'topup_rejected',jsonb_build_object('id',_id,'reason',_reason));

  PERFORM public.log_admin_action('topup_rejected', jsonb_build_object('id', _id, 'amount', _r.amount), _reason, _id, _r.user_id);

  INSERT INTO public.notifications(user_id,type,title,body)
    VALUES (_r.user_id,'wallet_topup','Top-up rejected',
            COALESCE(_reason,'Your top-up request was rejected.'));
  RETURN _r;
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_reject_withdrawal(_id uuid, _reason text)
 RETURNS wallet_withdrawal_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _r public.wallet_withdrawal_requests;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  UPDATE public.wallet_withdrawal_requests
    SET status='rejected', reject_reason=_reason, decided_by=auth.uid(), decided_at=now()
    WHERE id=_id AND status='pending'
    RETURNING * INTO _r;
  IF _r IS NULL THEN RAISE EXCEPTION 'Cannot reject'; END IF;

  PERFORM public.log_admin_action('withdrawal_rejected', jsonb_build_object('id', _id, 'amount', _r.amount), _reason, _id, _r.user_id);

  INSERT INTO public.notifications(user_id,type,title,body)
    VALUES (_r.user_id,'wallet_withdrawal','Withdrawal rejected',COALESCE(_reason,'Your withdrawal was rejected.'));
  RETURN _r;
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_revoke_role(_user_id uuid, _role app_role, _reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(),'super_admin') THEN
    RAISE EXCEPTION 'Only super admins can revoke roles';
  END IF;
  DELETE FROM public.user_roles WHERE user_id = _user_id AND role = _role;
  PERFORM public.log_admin_action('role_revoked', jsonb_build_object('role', _role), _reason, NULL, _user_id);
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_set_commission(_rate numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _old numeric;
BEGIN
  IF NOT public.has_role(auth.uid(),'super_admin') THEN
    RAISE EXCEPTION 'Only super admins can change commission';
  END IF;
  IF _rate < 0 OR _rate > 100 THEN RAISE EXCEPTION 'Rate must be 0-100'; END IF;
  SELECT (value)::numeric INTO _old FROM public.system_settings WHERE key = 'commission_rate';
  INSERT INTO public.system_settings(key, value, updated_by, updated_at)
  VALUES ('commission_rate', to_jsonb(_rate), auth.uid(), now())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = auth.uid(), updated_at = now();
  PERFORM public.log_admin_action('commission_changed', jsonb_build_object('old_rate', _old, 'new_rate', _rate));
  RETURN to_jsonb(_rate);
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_set_commission(_rate numeric, _reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _old numeric;
BEGIN
  IF NOT public.has_role(auth.uid(),'super_admin') THEN
    RAISE EXCEPTION 'Only super admins can change commission';
  END IF;
  IF _rate < 0 OR _rate > 100 THEN RAISE EXCEPTION 'Rate must be 0-100'; END IF;
  IF _reason IS NULL OR length(trim(_reason)) < 5 THEN
    RAISE EXCEPTION 'Give a reason for this change (at least 5 characters) — it is recorded in the audit log.';
  END IF;
  SELECT (value)::numeric INTO _old FROM public.system_settings WHERE key = 'commission_rate';
  INSERT INTO public.system_settings(key, value, updated_by, updated_at)
  VALUES ('commission_rate', to_jsonb(_rate), auth.uid(), now())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = auth.uid(), updated_at = now();
  PERFORM public.log_admin_action('commission_changed', jsonb_build_object('old_rate', _old, 'new_rate', _rate), _reason);
  RETURN to_jsonb(_rate);
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_set_demand_multiplier(_multiplier numeric, _reason text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare _n integer;
begin
  if not (public.has_role(auth.uid(), 'admin'::public.app_role)
       or public.has_role(auth.uid(), 'super_admin'::public.app_role)) then
    raise exception 'Forbidden';
  end if;

  if _multiplier is null or _multiplier <= 0 or _multiplier > 3.0 then
    raise exception 'Multiplier must be between 0 and 3.0';
  end if;
  if _reason is null or length(trim(_reason)) < 5 then
    raise exception 'Give a reason (e.g. "diesel up 8%%")';
  end if;

  update public.material_prices
     set demand_multiplier = _multiplier,
         updated_at = now(),
         updated_by = auth.uid()
   where enforced = true;

  get diagnostics _n = row_count;

  perform public.log_admin_action(
    'demand_multiplier_updated',
    jsonb_build_object('multiplier', _multiplier, 'materials_affected', _n),
    _reason, null, null);

  return _n;
end $function$
;

CREATE OR REPLACE FUNCTION public.admin_set_diesel_price(_price numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(),'super_admin') THEN
    RAISE EXCEPTION 'Only super admins can change diesel price';
  END IF;
  IF _price <= 0 OR _price > 100 THEN RAISE EXCEPTION 'Price must be between 0 and 100'; END IF;
  INSERT INTO public.system_settings(key, value, updated_by, updated_at)
  VALUES ('diesel_price_per_liter', to_jsonb(_price), auth.uid(), now())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = auth.uid(), updated_at = now();
  PERFORM public.log_admin_action('diesel_price_changed', NULL, NULL,
    jsonb_build_object('price', _price), NULL);
  RETURN to_jsonb(_price);
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_set_driver_verification(_user_id uuid, _status text, _notes text DEFAULT NULL::text)
 RETURNS driver_profiles
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _d public.driver_profiles; _old text;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF _status NOT IN ('pending','verified','rejected') THEN
    RAISE EXCEPTION 'Invalid status';
  END IF;

  SELECT verification_status::text INTO _old FROM public.driver_profiles WHERE user_id = _user_id;

  UPDATE public.driver_profiles
     SET verification_status = _status::verification_status,
         verification_notes = _notes,
         verified_at = CASE WHEN _status = 'verified' THEN now() ELSE verified_at END,
         reverify_due_at = CASE WHEN _status = 'verified' THEN now() + interval '90 days' ELSE reverify_due_at END
   WHERE user_id = _user_id
  RETURNING * INTO _d;

  IF NOT FOUND THEN RAISE EXCEPTION 'Driver profile not found'; END IF;

  PERFORM public.log_admin_action('driver_verification_changed', jsonb_build_object('old_status', _old, 'new_status', _status), _notes, NULL, _user_id);

  INSERT INTO public.notifications(user_id, type, title, body)
  VALUES (_user_id, 'driver_verification',
          CASE WHEN _status = 'verified' THEN 'You''re verified!' WHEN _status = 'rejected' THEN 'Verification rejected' ELSE 'Verification pending' END,
          COALESCE(_notes, CASE WHEN _status = 'verified' THEN 'You can now accept jobs. You''ll be asked to re-verify again in 90 days.' WHEN _status = 'rejected' THEN 'Please review and resubmit your documents.' ELSE 'Your documents are under review.' END));

  RETURN _d;
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_set_material_bucket_price(_material material_category, _bucket_m3 integer, _min_price numeric, _max_price numeric, _reason text)
 RETURNS material_price_buckets
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  _old public.material_price_buckets;
  _new public.material_price_buckets;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin'::public.app_role)
       OR public.has_role(auth.uid(), 'super_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  IF _min_price IS NULL OR _max_price IS NULL OR _min_price < 0 OR _max_price < _min_price THEN
    RAISE EXCEPTION 'Give a valid min/max price (min <= max, both >= 0).';
  END IF;

  IF _reason IS NULL OR length(trim(_reason)) < 5 THEN
    RAISE EXCEPTION 'Give a reason (at least 5 characters) — it is recorded in the admin audit log.';
  END IF;

  SELECT * INTO _old FROM public.material_price_buckets WHERE material = _material AND bucket_m3 = _bucket_m3;

  INSERT INTO public.material_price_buckets (material, bucket_m3, min_price, max_price, updated_at, updated_by)
  VALUES (_material, _bucket_m3, _min_price, _max_price, now(), auth.uid())
  ON CONFLICT (material, bucket_m3)
  DO UPDATE SET min_price = _min_price, max_price = _max_price, updated_at = now(), updated_by = auth.uid()
  RETURNING * INTO _new;

  PERFORM public.log_admin_action(
    'material_bucket_price_updated',
    jsonb_build_object(
      'material', _material::text, 'bucket_m3', _bucket_m3,
      'before', CASE WHEN _old.material IS NOT NULL THEN jsonb_build_object('min', _old.min_price, 'max', _old.max_price) ELSE NULL END,
      'after', jsonb_build_object('min', _new.min_price, 'max', _new.max_price)
    ),
    _reason, NULL, NULL
  );

  RETURN _new;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_set_material_pickup(_material text, _lat numeric, _lng numeric, _label text, _reason text)
 RETURNS material_prices
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _row public.material_prices;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF _reason IS NULL OR length(trim(_reason)) < 5 THEN
    RAISE EXCEPTION 'Give a reason for this change (at least 5 characters) — it is recorded in the audit log.';
  END IF;

  UPDATE public.material_prices
     SET pickup_lat = _lat, pickup_lng = _lng, pickup_label = _label,
         updated_by = auth.uid(), updated_at = now()
   WHERE material = _material::public.material_category
  RETURNING * INTO _row;

  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown material %', _material; END IF;

  PERFORM public.log_admin_action(
    'material_pickup_updated',
    jsonb_build_object('material', _material, 'lat', _lat, 'lng', _lng, 'label', _label),
    _reason
  );

  RETURN _row;
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_set_material_price(_material material_category, _min_price numeric, _max_price numeric, _demand_multiplier numeric DEFAULT NULL::numeric, _enforced boolean DEFAULT NULL::boolean, _label text DEFAULT NULL::text, _reason text DEFAULT NULL::text)
 RETURNS material_prices
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  _old public.material_prices;
  _new public.material_prices;
begin
  if not (public.has_role(auth.uid(), 'admin'::public.app_role)
       or public.has_role(auth.uid(), 'super_admin'::public.app_role)) then
    raise exception 'Forbidden';
  end if;

  select * into _old from public.material_prices where material = _material;
  if not found then
    raise exception 'No price row for material %', _material;
  end if;

  if _min_price is null or _max_price is null then
    raise exception 'Both min and max price are required';
  end if;
  if _max_price < _min_price then
    raise exception 'Max price ($%) cannot be below min price ($%)',
      _max_price, _min_price;
  end if;
  if _demand_multiplier is not null
     and (_demand_multiplier <= 0 or _demand_multiplier > 3.0) then
    raise exception 'Demand multiplier must be between 0 and 3.0';
  end if;

  -- a >25% move in one step is nearly always a typo
  if _old.min_price > 0
     and abs(_min_price - _old.min_price) / _old.min_price > 0.25
     and _reason is null then
    raise exception
      'Min price moves %.0f%% (from $% to $%). Supply a reason to confirm.',
      abs(_min_price - _old.min_price) / _old.min_price * 100,
      _old.min_price, _min_price;
  end if;

  update public.material_prices
     set min_price         = _min_price,
         max_price         = _max_price,
         demand_multiplier = coalesce(_demand_multiplier, demand_multiplier),
         enforced          = coalesce(_enforced, enforced),
         label             = coalesce(_label, label),
         updated_at        = now(),
         updated_by        = auth.uid()
   where material = _material
  returning * into _new;

  perform public.log_admin_action(
    'material_price_updated',
    jsonb_build_object(
      'material', _material::text,
      'before', jsonb_build_object(
        'min', _old.min_price, 'max', _old.max_price,
        'multiplier', _old.demand_multiplier, 'enforced', _old.enforced),
      'after', jsonb_build_object(
        'min', _new.min_price, 'max', _new.max_price,
        'multiplier', _new.demand_multiplier, 'enforced', _new.enforced)),
    _reason, null, null);

  return _new;
end $function$
;

CREATE OR REPLACE FUNCTION public.admin_set_user_status(_user_id uuid, _status account_status)
 RETURNS profiles
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _p public.profiles; _old account_status;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  SELECT status INTO _old FROM public.profiles WHERE id = _user_id;
  UPDATE public.profiles SET status = _status, updated_at = now()
  WHERE id = _user_id RETURNING * INTO _p;
  PERFORM public.log_admin_action('user_status_changed', jsonb_build_object('old_status', _old, 'new_status', _status), NULL, NULL, _user_id);

  INSERT INTO public.notifications(user_id, type, title, body)
  VALUES (_user_id, 'user_status_changed',
          CASE WHEN _status = 'active' THEN 'Your account is active again' ELSE 'Your account status changed' END,
          CASE WHEN _status = 'suspended' THEN 'Your account has been suspended. Contact support for details.'
               WHEN _status = 'banned' THEN 'Your account has been banned.'
               ELSE 'Your account is now active.' END);

  RETURN _p;
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_set_user_status(_user_id uuid, _status account_status, _reason text DEFAULT NULL::text)
 RETURNS profiles
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _p public.profiles; _old account_status;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF _status <> 'active' AND (_reason IS NULL OR length(trim(_reason)) < 5) THEN
    RAISE EXCEPTION 'Give a reason for suspending/banning this account (at least 5 characters) — it is recorded in the audit log.';
  END IF;
  SELECT status INTO _old FROM public.profiles WHERE id = _user_id;
  UPDATE public.profiles SET status = _status, updated_at = now()
  WHERE id = _user_id RETURNING * INTO _p;
  PERFORM public.log_admin_action('user_status_changed', jsonb_build_object('old_status', _old, 'new_status', _status), _reason, NULL, _user_id);

  INSERT INTO public.notifications(user_id, type, title, body)
  VALUES (_user_id, 'user_status_changed',
          CASE WHEN _status = 'active' THEN 'Your account is active again' ELSE 'Your account status changed' END,
          CASE WHEN _status = 'suspended' THEN COALESCE('Your account has been suspended. Reason: ' || _reason, 'Your account has been suspended. Contact support for details.')
               WHEN _status = 'banned' THEN COALESCE('Your account has been banned. Reason: ' || _reason, 'Your account has been banned.')
               ELSE 'Your account is now active.' END);

  RETURN _p;
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_waive_strike(_event_id uuid, _reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE _ev public.cancellation_events; _strikes int;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin'::public.app_role)
       OR public.has_role(auth.uid(), 'super_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  UPDATE public.cancellation_events
     SET waived_at = now(), waived_by = auth.uid(), waive_reason = _reason
   WHERE id = _event_id AND waived_at IS NULL
  RETURNING * INTO _ev;

  IF NOT FOUND THEN RAISE EXCEPTION 'Event not found or already waived'; END IF;

  _strikes := public.recent_cancellation_strikes(_ev.user_id);

  UPDATE public.profiles
     SET cancellation_strikes = _strikes,
         restricted_until = CASE WHEN _strikes < 3 THEN NULL ELSE restricted_until END,
         restriction_reason = CASE WHEN _strikes < 3 THEN NULL ELSE restriction_reason END
   WHERE id = _ev.user_id;

  PERFORM public.log_admin_action('strike_waived', jsonb_build_object('event_id', _event_id, 'strikes_now', _strikes), _reason, _event_id, _ev.user_id);

  RETURN jsonb_build_object('user_id', _ev.user_id, 'strikes_now', _strikes);
END $function$
;

CREATE OR REPLACE FUNCTION public.auto_release_escrow_payments()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _cnt integer := 0; _row public.jobs;
BEGIN
  FOR _row IN
    SELECT j.* FROM public.jobs j
    WHERE j.payment_method = 'escrow'
      AND j.status IN ('accepted', 'in_progress')
      AND j.delivery_photo_taken_at IS NOT NULL
      AND j.delivery_photo_taken_at < now() - interval '72 hours'
      AND NOT EXISTS (
        SELECT 1 FROM public.disputes d
        WHERE d.job_id = j.id AND d.status IN ('open', 'investigating')
      )
      AND EXISTS (
        SELECT 1 FROM public.payments p
        WHERE p.job_id = j.id AND p.type = 'escrow' AND p.status = 'paid'
      )
    FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      PERFORM public.release_escrow_and_complete(_row.id, _row.driver_id);
      _cnt := _cnt + 1;
    EXCEPTION WHEN OTHERS THEN
      -- Don't let one bad row abort the whole sweep — log and move on.
      RAISE WARNING 'auto_release_escrow_payments failed for job %: %', _row.id, SQLERRM;
    END;
  END LOOP;
  RETURN _cnt;
END $function$
;

CREATE OR REPLACE FUNCTION public.bids_guard_direct_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  _is_admin boolean;
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if auth.uid() is null then
    raise exception 'Not authorised to update this bid.' using errcode = '42501';
  end if;

  _is_admin := public.has_role(auth.uid(), 'admin'::public.app_role)
            or public.has_role(auth.uid(), 'super_admin'::public.app_role);
  if _is_admin then return new; end if;

  if new.status     is distinct from old.status
     or new.job_id    is distinct from old.job_id
     or new.driver_id is distinct from old.driver_id
     or new.created_at is distinct from old.created_at
     or new.customer_counter_price is distinct from old.customer_counter_price
     or new.counter_status is distinct from old.counter_status
  then
    raise exception 'A bid''s status and counter-offer fields can only be changed through the app.'
      using errcode = '42501';
  end if;

  if old.driver_id = auth.uid() then
    if old.status <> 'pending' then
      raise exception 'This bid has already been decided and can no longer be edited.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  raise exception 'Not authorised to update this bid.' using errcode = '42501';
end $function$
;

CREATE OR REPLACE FUNCTION public.cancel_job(_job_id uuid, _reason text DEFAULT NULL::text)
 RETURNS jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  _job public.jobs; _stage text; _is_admin boolean;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;

  select * into _job from public.jobs where id = _job_id for update;
  if not found then raise exception 'Job not found'; end if;

  _is_admin := public.has_role(auth.uid(), 'admin'::public.app_role)
            or public.has_role(auth.uid(), 'super_admin'::public.app_role);

  if not (_is_admin or auth.uid() = _job.customer_id or auth.uid() = _job.driver_id) then
    raise exception 'Not authorised to cancel this job';
  end if;
  if _job.status in ('completed','cancelled') then
    raise exception 'Job already % and cannot be cancelled', _job.status;
  end if;
  if _job.status = 'in_progress' and not _is_admin then
    raise exception 'Job is in progress — raise a dispute instead of cancelling';
  end if;

  _stage := case _job.status
              when 'open' then 'pre_acceptance'
              when 'accepted' then 'post_acceptance'
              when 'in_progress' then 'in_transit'
              else _job.status::text end;

  perform public.release_job_commission(_job_id);

  update public.jobs
     set status = 'cancelled', cancellation_reason = _reason,
         cancellation_stage = _stage, cancelled_at = now(),
         cancelled_by = auth.uid()
   where id = _job_id
  returning * into _job;

  update public.job_dispatch_offers
     set status = 'superseded', responded_at = now()
   where job_id = _job_id and status = 'pending';

  -- FIX: was `update profiles set cancellation_strikes = ... + 1`
  -- against a column that does not exist -> 42703 -> rollback.
  if _stage <> 'pre_acceptance' and auth.uid() = _job.customer_id then
    perform public.enforce_customer_strikes(_job.customer_id, _job_id, _stage, _reason);
  end if;

  -- driver abandoning an accepted job also gets logged (no
  -- restriction yet — dispatch already deprioritises them)
  if _stage <> 'pre_acceptance' and auth.uid() = _job.driver_id then
    insert into public.cancellation_events(user_id, job_id, role, stage, reason)
    values (_job.driver_id, _job_id, 'driver', _stage, _reason);
  end if;

  if _job.driver_id is not null and auth.uid() <> _job.driver_id then
    insert into public.notifications (user_id, type, title, body)
    values (_job.driver_id, 'job_cancelled', 'Job cancelled',
            coalesce(_reason, 'The customer cancelled this job.'));
  end if;
  if auth.uid() <> _job.customer_id then
    insert into public.notifications (user_id, type, title, body)
    values (_job.customer_id, 'job_cancelled', 'Job cancelled',
            coalesce(_reason, 'This job was cancelled.'));
  end if;

  return _job;
end $function$
;

CREATE OR REPLACE FUNCTION public.cancel_topup(_id uuid)
 RETURNS wallet_topup_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _r public.wallet_topup_requests;
BEGIN
  UPDATE public.wallet_topup_requests
    SET status='cancelled', decided_at=now()
    WHERE id=_id AND user_id=auth.uid() AND status='pending'
    RETURNING * INTO _r;
  IF _r IS NULL THEN RAISE EXCEPTION 'Cannot cancel'; END IF;
  INSERT INTO public.wallet_audit_log(user_id,actor_id,action,meta)
    VALUES (auth.uid(),auth.uid(),'topup_cancelled',jsonb_build_object('id',_id));
  RETURN _r;
END $function$
;

CREATE OR REPLACE FUNCTION public.cancel_withdrawal(_id uuid)
 RETURNS wallet_withdrawal_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _r public.wallet_withdrawal_requests;
BEGIN
  UPDATE public.wallet_withdrawal_requests
    SET status='cancelled', decided_at=now()
    WHERE id=_id AND user_id=auth.uid() AND status='pending'
    RETURNING * INTO _r;
  IF _r IS NULL THEN RAISE EXCEPTION 'Cannot cancel'; END IF;
  RETURN _r;
END $function$
;

CREATE OR REPLACE FUNCTION public.claim_super_admin()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'super_admin') THEN
    RAISE EXCEPTION 'Super admin already exists';
  END IF;
  INSERT INTO public.user_roles(user_id, role) VALUES (auth.uid(), 'super_admin') ON CONFLICT DO NOTHING;
  INSERT INTO public.user_roles(user_id, role) VALUES (auth.uid(), 'admin') ON CONFLICT DO NOTHING;
END $function$
;

CREATE OR REPLACE FUNCTION public.complete_job(_job_id uuid)
 RETURNS jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  _job public.jobs; _rate numeric; _commission numeric;
  _new_bal numeric; _free_used boolean; _has_profile boolean; _level driver_level;
begin
  select * into _job from public.jobs where id = _job_id for update;
  if not found then raise exception 'Job not found'; end if;

  if _job.customer_id <> auth.uid() then
    raise exception 'Only the customer can confirm completion';
  end if;
  if _job.status not in ('accepted','in_progress') then
    raise exception 'Job not in progress';
  end if;

  if _job.payment_method = 'escrow' then
    return public.release_escrow_and_complete(_job_id, auth.uid());
  end if;

  select (value::text)::numeric into _rate
    from public.system_settings where key = 'commission_rate';
  if _rate is null then raise exception 'commission_rate not configured'; end if;

  select first_job_free_used, true, level into _free_used, _has_profile, _level
    from public.driver_profiles where user_id = _job.driver_id;

  if not coalesce(_has_profile, false) then
    raise exception 'Driver profile missing for driver %', _job.driver_id;
  end if;

  perform public.release_job_commission(_job_id);

  if _free_used is not true then
    _commission := 0;
    update public.driver_profiles
       set first_job_free_used = true where user_id = _job.driver_id;

    insert into public.wallet_transactions
      (user_id, type, amount, balance_after, job_id, note, created_by)
    values (_job.driver_id, 'commission', 0,
      coalesce((select balance from public.wallets
                 where user_id = _job.driver_id), 0),
      _job.id, 'First job free — no commission', auth.uid());
  else
    if _job.final_price is null and _job.budget is null then
      raise exception 'Cannot compute commission: job % has no final_price or budget', _job_id;
    end if;

    _commission := round(coalesce(_job.final_price, _job.budget) * _rate / 100.0
                          * public.driver_level_commission_multiplier(_level), 2);

    update public.wallets
       set balance = balance - _commission, updated_at = now()
     where user_id = _job.driver_id
    returning balance into _new_bal;

    if _new_bal is null then
      raise exception 'Driver % has no wallet', _job.driver_id;
    end if;

    update public.wallets
       set limited = (_new_bal < 0) where user_id = _job.driver_id;

    insert into public.wallet_transactions
      (user_id, type, amount, balance_after, job_id, note, created_by)
    values (_job.driver_id, 'commission', -_commission, _new_bal, _job.id,
            format('Commission %s%% on job (%s tier)', _rate, _level), auth.uid());
  end if;

  update public.driver_profiles
     set jobs_completed = jobs_completed + 1 where user_id = _job.driver_id;

  update public.jobs
     set status = 'completed', commission = _commission
   where id = _job_id
  returning * into _job;

  if exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='jobs'
                and column_name='completed_at') then
    execute 'update public.jobs set completed_at = now() where id = $1' using _job_id;
  end if;

  if to_regprocedure('public.issue_pod(uuid)') is not null then
    perform public.issue_pod(_job_id);
  end if;

  return _job;
end $function$
;

CREATE OR REPLACE FUNCTION public.compute_material_offer(_material material_category, _quantity numeric, _distance_km numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _mp public.material_prices;
  _bucket public.material_price_buckets;
  _mid_bucket_price numeric;
  _material_component numeric;
  _distance numeric;
  _transport numeric;
  _raw numeric;
  _floor numeric;
  _step int;
  _offer numeric;
  _adjust_max numeric;
  _diesel_price numeric;
  _fuel_l_per_100km constant numeric := 32;
  _long_haul_markup constant numeric := 1.5;
  _long_haul_rate numeric;
  _qty numeric;
BEGIN
  SELECT * INTO _mp FROM public.material_prices WHERE material = _material;
  IF _mp IS NULL OR NOT _mp.enforced THEN
    RETURN jsonb_build_object(
      'offer', NULL, 'min', NULL, 'max', NULL, 'step', 5, 'enforced', false
    );
  END IF;

  _qty := COALESCE(_quantity, 12.5);

  -- Round up to the smallest available bucket that covers this quantity.
  SELECT * INTO _bucket
  FROM public.material_price_buckets
  WHERE material = _material AND bucket_m3 >= _qty
  ORDER BY bucket_m3 ASC
  LIMIT 1;

  IF _bucket IS NULL THEN
    -- Either no buckets exist for this material, or the quantity exceeds
    -- the largest bucket (20m³) — either way this needs a human quote,
    -- not an automatic price.
    RETURN jsonb_build_object(
      'offer', NULL, 'min', NULL, 'max', NULL, 'step', 5,
      'label', _mp.label, 'unit', _mp.unit, 'enforced', true,
      'requiresCustomQuote', true
    );
  END IF;

  SELECT (value::text)::numeric INTO _diesel_price FROM public.system_settings WHERE key = 'diesel_price_per_liter';
  _diesel_price := COALESCE(_diesel_price, 1.87);
  _long_haul_rate := (_fuel_l_per_100km / 100) * _diesel_price * _long_haul_markup;

  -- The bucket price IS the whole-load material cost — not multiplied by
  -- quantity again, since it already represents a full 10/12/15/20m³ load.
  _mid_bucket_price := (_bucket.min_price + _bucket.max_price) / 2.0 * COALESCE(_mp.demand_multiplier, 1.0);
  _material_component := _mid_bucket_price;

  _distance := COALESCE(_distance_km, 15);
  _transport := CASE
    WHEN _distance <= 10 THEN 20
    WHEN _distance <= 20 THEN 30
    WHEN _distance <= 30 THEN 40
    WHEN _distance <= 50 THEN 60
    ELSE 60 + (_distance - 50) * _long_haul_rate
  END;

  _floor := _bucket.min_price;
  _raw := GREATEST(_floor, _material_component + _transport);

  IF _raw < 100 THEN _step := 5;
  ELSIF _raw < 300 THEN _step := 10;
  ELSE _step := 20;
  END IF;

  _offer := GREATEST(_floor, ROUND(_raw / _step) * _step);
  _adjust_max := GREATEST(_bucket.max_price + _transport, _offer + _step * 3);

  RETURN jsonb_build_object(
    'offer', _offer,
    'min', ROUND(_floor),
    'max', ROUND(_adjust_max),
    'step', _step,
    'label', _mp.label,
    'unit', _mp.unit,
    'enforced', true,
    'materialCost', ROUND(_material_component, 2),
    'transportCost', ROUND(_transport, 2),
    'bucketM3', _bucket.bucket_m3
  );
END
$function$
;

CREATE OR REPLACE FUNCTION public.count_available_verified_drivers(_job_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  _job  public.jobs;
  _rate numeric;
  _req  numeric;
  _n    integer;
begin
  select * into _job from public.jobs where id = _job_id;
  if not found then return 0; end if;

  select (value::text)::numeric into _rate
    from public.system_settings where key = 'commission_rate';
  _rate := coalesce(_rate, 7);

  _req := round(coalesce(_job.final_price, _job.budget, 0) * _rate / 100.0, 2);

  select count(*)::int into _n
  from public.driver_profiles dp
  join public.profiles p on p.id = dp.user_id
  left join public.wallets w on w.user_id = dp.user_id
  where dp.verification_status = 'verified'
    and p.status = 'active'
    and coalesce(w.limited, false) = false
    and (
      -- first job is free, so no balance needed
      coalesce(dp.first_job_free_used, false) = false
      or (coalesce(w.balance, 0) - coalesce(w.held, 0)) >= _req
    )
    and dp.user_id <> _job.customer_id;

  return coalesce(_n, 0);
end $function$
;

CREATE OR REPLACE FUNCTION public.counter_bid(_bid_id uuid, _price numeric)
 RETURNS bids
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _bid public.bids; _job public.jobs;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  IF _price IS NULL OR _price <= 0 THEN RAISE EXCEPTION 'Enter a valid price'; END IF;

  SELECT * INTO _bid FROM public.bids WHERE id = _bid_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bid not found'; END IF;
  IF _bid.status <> 'pending' THEN RAISE EXCEPTION 'This bid is no longer open'; END IF;

  SELECT * INTO _job FROM public.jobs WHERE id = _bid.job_id;
  IF _job.customer_id <> auth.uid() THEN RAISE EXCEPTION 'Not your job'; END IF;
  IF _job.status <> 'open' THEN RAISE EXCEPTION 'Job is no longer open'; END IF;

  UPDATE public.bids
     SET customer_counter_price = _price, counter_status = 'countered'
   WHERE id = _bid_id
  RETURNING * INTO _bid;

  INSERT INTO public.notifications(user_id, type, title, body, job_id)
  VALUES (_bid.driver_id, 'bid_countered', 'Customer proposed a new price',
          format('They offered $%s on your bid of $%s for %s.', _price::text, _bid.price::text, _job.material),
          _job.id);

  RETURN _bid;
END $function$
;

CREATE OR REPLACE FUNCTION public.create_dispatch_wave(_job_id uuid, _limit integer DEFAULT 5)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  next_wave integer;
  created_count integer := 0;
  job_row public.jobs%ROWTYPE;
BEGIN
  SELECT * INTO job_row FROM public.jobs WHERE id = _job_id;
  IF NOT FOUND OR job_row.status <> 'open' THEN
    RETURN 0;
  END IF;

  SELECT COALESCE(MAX(wave), 0) + 1 INTO next_wave
  FROM public.job_dispatch_offers WHERE job_id = _job_id;

  INSERT INTO public.job_dispatch_offers (job_id, driver_id, wave, expires_at)
  SELECT _job_id, ur.user_id, next_wave, now() + interval '10 seconds'
  FROM public.user_roles ur
  JOIN public.driver_profiles dp ON dp.user_id = ur.user_id
  WHERE ur.role = 'driver'
    AND dp.verification_status = 'verified'
    AND ur.user_id <> job_row.customer_id
    AND NOT EXISTS (
      SELECT 1 FROM public.job_dispatch_offers o
      WHERE o.job_id = _job_id AND o.driver_id = ur.user_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.jobs j2
      WHERE j2.driver_id = ur.user_id
        AND j2.status IN ('accepted','in_progress')
    )
  ORDER BY dp.rating_avg DESC NULLS LAST, dp.jobs_completed DESC
  LIMIT _limit;

  GET DIAGNOSTICS created_count = ROW_COUNT;
  RETURN created_count;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.credit_wallet_from_payment(_payment_id uuid)
 RETURNS wallets
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _p public.payments;
  _new_bal numeric;
  _w public.wallets;
begin
  select * into _p from public.payments where id = _payment_id for update;
  if not found then raise exception 'Payment not found'; end if;

  -- idempotent: safe to call more than once for the same payment
  if _p.status = 'paid' then
    select * into _w from public.wallets where user_id = _p.user_id;
    return _w;
  end if;

  if _p.type <> 'topup' then
    raise exception 'Payment % is not a topup', _payment_id;
  end if;

  -- wallets.balance has no currency. Until it does, a ZWG payment
  -- would silently inflate a USD balance. Fail loudly instead.
  if coalesce(_p.currency, 'USD') <> 'USD' then
    raise exception 'Only USD top-ups are supported (payment % is %)',
      _payment_id, _p.currency;
  end if;

  insert into public.wallets(user_id, balance) values (_p.user_id, 0)
    on conflict (user_id) do nothing;

  update public.wallets
     set balance = balance + _p.amount, updated_at = now(), limited = false
   where user_id = _p.user_id
  returning balance into _new_bal;

  insert into public.wallet_transactions(user_id, type, amount, balance_after, note, created_by)
  values (_p.user_id, 'topup', _p.amount, _new_bal,
          format('Paynow top-up (ref %s)', coalesce(_p.paynow_reference, '-')),
          _p.user_id);

  update public.payments set status = 'paid', updated_at = now() where id = _payment_id;

  insert into public.wallet_audit_log(user_id, actor_id, action, meta)
  values (_p.user_id, _p.user_id, 'paynow_topup_credited',
          jsonb_build_object('payment_id', _payment_id, 'amount', _p.amount,
                             'currency', _p.currency));

  insert into public.notifications(user_id, type, title, body)
  values (_p.user_id, 'wallet_topup', 'Top-up successful',
          format('$%s added to your wallet via Paynow.', _p.amount::text));

  select * into _w from public.wallets where user_id = _p.user_id;
  return _w;
end $function$
;

CREATE OR REPLACE FUNCTION public.driver_active_jobs()
 RETURNS TABLE(id uuid, status text, material text, custom_material text, quantity_m3 numeric, final_price numeric, delivery_address text, delivery_lat double precision, delivery_lng double precision, preferred_date date, notes text, accepted_at timestamp with time zone, held_commission numeric, customer_name text, customer_phone text, pickup_photo_url text, delivery_photo_url text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;

  return query
  select
    j.id, j.status::text, j.material::text, j.custom_material,
    j.quantity_m3, j.final_price, j.delivery_address,
    j.delivery_lat, j.delivery_lng, j.preferred_date, j.notes,
    j.updated_at as accepted_at,
    j.held_commission,
    cp.full_name as customer_name,
    -- phone only while the job is live; history hides it
    cp.phone     as customer_phone,
    j.pickup_photo_url, j.delivery_photo_url
  from public.jobs j
  left join public.profiles cp on cp.id = j.customer_id
  where j.driver_id = auth.uid()
    and j.status in ('accepted','in_progress')
  order by j.updated_at desc;
end $function$
;

CREATE OR REPLACE FUNCTION public.driver_available_jobs(_limit integer DEFAULT 50, _offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, material text, custom_material text, quantity_m3 numeric, budget numeric, delivery_address text, delivery_lat double precision, delivery_lng double precision, preferred_date date, notes text, created_at timestamp with time zone, expires_at timestamp with time zone, bid_count bigint, my_bid_id uuid, my_bid_price numeric, my_offer_id uuid, offer_expires_at timestamp with time zone, commission_due numeric, can_afford boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  _rate  numeric;
  _avail numeric;
  _free  boolean;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;

  -- must be a driver
  if not exists (select 1 from public.driver_profiles where user_id = auth.uid()) then
    raise exception 'Driver profile required';
  end if;

  select (value::text)::numeric into _rate
    from public.system_settings where key = 'commission_rate';
  _rate := coalesce(_rate, 0);

  select coalesce(balance,0) - coalesce(held,0) into _avail
    from public.wallets where user_id = auth.uid();
  _avail := coalesce(_avail, 0);

  select coalesce(first_job_free_used, false) into _free
    from public.driver_profiles where user_id = auth.uid();

  return query
  select
    j.id,
    j.material::text,
    j.custom_material,
    j.quantity_m3,
    j.budget,
    j.delivery_address,
    j.delivery_lat,
    j.delivery_lng,
    j.preferred_date,
    j.notes,
    j.created_at,
    j.expires_at,
    (select count(*) from public.bids b where b.job_id = j.id
       and b.status = 'pending')                                as bid_count,
    mb.id                                                       as my_bid_id,
    mb.price                                                    as my_bid_price,
    off.id                                                      as my_offer_id,
    off.expires_at                                              as offer_expires_at,
    case when _free then round(coalesce(j.budget,0) * _rate / 100.0, 2)
         else 0 end                                             as commission_due,
    case when not _free then true
         else _avail >= round(coalesce(j.budget,0) * _rate / 100.0, 2)
    end                                                         as can_afford
  from public.jobs j
  left join lateral (
    select b.id, b.price from public.bids b
     where b.job_id = j.id and b.driver_id = auth.uid()
       and b.status = 'pending'
     limit 1
  ) mb on true
  left join lateral (
    select o.id, o.expires_at from public.job_dispatch_offers o
     where o.job_id = j.id and o.driver_id = auth.uid()
       and o.status = 'pending' and o.expires_at > now()
     limit 1
  ) off on true
  where j.status = 'open'
    and j.driver_id is null                       -- not already taken
    and (j.expires_at is null or j.expires_at > now())
    and j.customer_id <> auth.uid()               -- never your own job
  order by
    (off.id is not null) desc,                    -- direct offers first
    j.created_at desc
  limit  greatest(1, least(_limit, 100))
  offset greatest(0, _offset);
end $function$
;

CREATE OR REPLACE FUNCTION public.driver_can_accept(_job_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  _job  public.jobs;
  _rate numeric;
  _req  numeric;
  _bal  numeric;
  _held numeric;
  _avail numeric;
  _free boolean;
  _has_profile boolean;
begin
  select * into _job from public.jobs where id = _job_id;
  if not found then raise exception 'Job not found'; end if;

  select first_job_free_used, true into _free, _has_profile
    from public.driver_profiles where user_id = auth.uid();

  if not coalesce(_has_profile, false) then
    return jsonb_build_object('ok', false, 'required', 0, 'balance', 0,
      'held', 0, 'available', 0, 'shortfall', 0,
      'free', false, 'reason', 'no_driver_profile');
  end if;

  select coalesce(balance,0), coalesce(held,0) into _bal, _held
    from public.wallets where user_id = auth.uid();
  _bal  := coalesce(_bal, 0);
  _held := coalesce(_held, 0);
  _avail := _bal - _held;

  if _free is not true then
    return jsonb_build_object('ok', true, 'required', 0, 'balance', _bal,
      'held', _held, 'available', _avail, 'shortfall', 0, 'free', true);
  end if;

  select (value::text)::numeric into _rate
    from public.system_settings where key = 'commission_rate';
  if _rate is null then raise exception 'commission_rate not configured'; end if;

  _req := round(coalesce(_job.final_price, _job.budget, 0) * _rate / 100.0, 2);

  return jsonb_build_object(
    'ok', _avail >= _req, 'required', _req, 'balance', _bal,
    'held', _held, 'available', _avail,
    'shortfall', greatest(0, _req - _avail), 'free', false);
end $function$
;

CREATE OR REPLACE FUNCTION public.driver_can_accept_for(_job_id uuid, _driver_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  _job public.jobs; _rate numeric; _req numeric;
  _bal numeric; _held numeric; _avail numeric;
  _free boolean; _has_profile boolean;
begin
  select * into _job from public.jobs where id = _job_id;
  if not found then raise exception 'Job not found'; end if;

  select first_job_free_used, true into _free, _has_profile
    from public.driver_profiles where user_id = _driver_id;
  if not coalesce(_has_profile, false) then
    return jsonb_build_object('ok', false, 'required', 0, 'available', 0,
      'reason', 'no_driver_profile');
  end if;

  select coalesce(balance,0), coalesce(held,0) into _bal, _held
    from public.wallets where user_id = _driver_id;
  _avail := coalesce(_bal,0) - coalesce(_held,0);

  if _free is not true then
    return jsonb_build_object('ok', true, 'required', 0,
      'available', _avail, 'free', true);
  end if;

  select (value::text)::numeric into _rate
    from public.system_settings where key = 'commission_rate';
  if _rate is null then raise exception 'commission_rate not configured'; end if;

  _req := round(coalesce(_job.final_price, _job.budget, 0) * _rate / 100.0, 2);

  return jsonb_build_object('ok', _avail >= _req, 'required', _req,
    'available', _avail, 'shortfall', greatest(0, _req - _avail), 'free', false);
end $function$
;

CREATE OR REPLACE FUNCTION public.driver_confirm_delivery_pin(_job_id uuid, _pin text)
 RETURNS jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _job public.jobs;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;

  SELECT * INTO _job FROM public.jobs WHERE id = _job_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Job not found'; END IF;
  IF _job.driver_id <> auth.uid() THEN RAISE EXCEPTION 'Not your job'; END IF;
  IF _job.payment_method <> 'escrow' THEN RAISE EXCEPTION 'This job does not use delivery PIN confirmation'; END IF;
  IF _job.status NOT IN ('accepted', 'in_progress') THEN RAISE EXCEPTION 'Job not in progress'; END IF;
  IF _job.delivery_photo_url IS NULL THEN RAISE EXCEPTION 'Upload the delivery photo first'; END IF;
  IF _job.delivery_pin IS NULL OR trim(_pin) <> _job.delivery_pin THEN
    RAISE EXCEPTION 'Incorrect code — ask the customer for the code shown in their app';
  END IF;

  RETURN public.release_escrow_and_complete(_job_id, auth.uid());
END $function$
;

CREATE OR REPLACE FUNCTION public.driver_dashboard_summary()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare _r jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;

  select jsonb_build_object(
    'balance',        coalesce(w.balance, 0),
    'held',           coalesce(w.held, 0),
    'available',      coalesce(w.balance,0) - coalesce(w.held,0),
    'limited',        coalesce(w.limited, false),
    'jobs_completed', coalesce(dp.jobs_completed, 0),
    'rating_avg',     dp.rating_avg,
    'rating_count',   dp.rating_count,
    'level',          dp.level,
    'verification',   dp.verification_status,
    'active_jobs',    (select count(*) from public.jobs
                        where driver_id = auth.uid()
                          and status in ('accepted','in_progress')),
    'open_offers',    (select count(*) from public.job_dispatch_offers
                        where driver_id = auth.uid()
                          and status = 'pending' and expires_at > now()),
    'earned_total',   (select coalesce(sum(coalesce(final_price,0)
                                         - coalesce(commission,0)), 0)
                         from public.jobs
                        where driver_id = auth.uid() and status = 'completed')
  ) into _r
  from public.driver_profiles dp
  left join public.wallets w on w.user_id = dp.user_id
  where dp.user_id = auth.uid();

  return coalesce(_r, jsonb_build_object('error','no_driver_profile'));
end $function$
;

CREATE OR REPLACE FUNCTION public.driver_job_history(_limit integer DEFAULT 30, _offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, status text, material text, custom_material text, quantity_m3 numeric, final_price numeric, commission numeric, net_earned numeric, delivery_address text, completed_at timestamp with time zone, cancelled_at timestamp with time zone, cancellation_reason text, cancelled_by_me boolean, customer_name text, pod_token text, total_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;

  return query
  select
    j.id, j.status::text, j.material::text, j.custom_material,
    j.quantity_m3, j.final_price, j.commission,
    coalesce(j.final_price,0) - coalesce(j.commission,0) as net_earned,
    j.delivery_address,
    j.completed_at,
    j.cancelled_at,
    j.cancellation_reason,
    (j.cancelled_by = auth.uid())                       as cancelled_by_me,
    cp.full_name                                        as customer_name,
    p.share_token                                       as pod_token,
    count(*) over ()                                    as total_count
  from public.jobs j
  left join public.profiles cp on cp.id = j.customer_id
  left join public.pods     p  on p.job_id = j.id
  where j.driver_id = auth.uid()
    and j.status in ('completed','cancelled')
  order by coalesce(j.completed_at, j.cancelled_at, j.updated_at) desc
  limit  greatest(1, least(_limit, 100))
  offset greatest(0, _offset);
end $function$
;

CREATE OR REPLACE FUNCTION public.driver_level_commission_multiplier(_level driver_level)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE _level
    WHEN 'platinum' THEN 0.80  -- 20% off commission
    WHEN 'gold'     THEN 0.90  -- 10% off commission
    WHEN 'silver'   THEN 0.95  -- 5% off commission
    ELSE 1.00                  -- bronze: full rate
  END;
$function$
;

CREATE OR REPLACE FUNCTION public.driver_profiles_guard_direct_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  _is_admin boolean;
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if auth.uid() is null then
    raise exception 'Not authorised to update this profile.' using errcode = '42501';
  end if;

  _is_admin := public.has_role(auth.uid(), 'admin'::public.app_role)
            or public.has_role(auth.uid(), 'super_admin'::public.app_role);
  if _is_admin then return new; end if;

  -- self-service only: everything below this point is the driver
  -- editing their own row (RLS already enforces user_id = auth.uid())

  if new.verification_notes is distinct from old.verification_notes
     or new.level              is distinct from old.level
     or new.rating_avg         is distinct from old.rating_avg
     or new.rating_count       is distinct from old.rating_count
     or new.jobs_completed     is distinct from old.jobs_completed
     or new.first_job_free_used is distinct from old.first_job_free_used
     or new.withdrawal_pin_hash is distinct from old.withdrawal_pin_hash
     or new.user_id            is distinct from old.user_id
     or new.created_at         is distinct from old.created_at
  then
    raise exception 'This field can only be changed by an admin or the app''s own actions.'
      using errcode = '42501';
  end if;

  -- verification_status: a driver may only (re)submit for review,
  -- never approve or reject themselves
  if new.verification_status is distinct from old.verification_status
     and new.verification_status <> 'pending'
  then
    raise exception 'Only an admin can verify or reject a driver.' using errcode = '42501';
  end if;

  return new;
end $function$
;


CREATE OR REPLACE FUNCTION public.enforce_customer_strikes(_user_id uuid, _job_id uuid, _stage text, _reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  _strikes   int;
  _until     timestamptz;
  _restrict  text;
  _title     text;
  _body      text;
begin
  insert into public.cancellation_events(user_id, job_id, role, stage, reason)
  values (_user_id, _job_id, 'customer', _stage, _reason);

  _strikes := public.recent_cancellation_strikes(_user_id);

  -- cached rollup for cheap reads
  update public.profiles
     set cancellation_strikes = _strikes
   where id = _user_id;

  -- ---- the ladder (tune here) -------------------------------
  if _strikes >= 7 then
    _until    := now() + interval '30 days';
    _restrict := 'Repeated cancellations after drivers accepted. Contact support.';
    _title    := 'Account restricted';
    _body     := 'Your account is restricted for 30 days after repeated cancellations. Contact support to appeal.';
  elsif _strikes >= 5 then
    _until    := now() + interval '7 days';
    _restrict := 'Five cancellations after acceptance in 90 days.';
    _title    := 'Booking paused for 7 days';
    _body     := 'You have cancelled 5 accepted jobs in 90 days. You can book again in 7 days.';
  elsif _strikes >= 3 then
    _until    := now() + interval '24 hours';
    _restrict := 'Three cancellations after acceptance in 90 days.';
    _title    := 'Booking paused for 24 hours';
    _body     := 'You have cancelled 3 accepted jobs. You can book again in 24 hours. Cancelling after a driver has accepted costs them a trip.';
  else
    _until    := null;
    _title    := 'Cancellation recorded';
    _body     := format('You cancelled a job a driver had already accepted (%s of 3 before booking is paused). Cancelling before acceptance is always free.', _strikes);
  end if;

  if _until is not null then
    update public.profiles
       set restricted_until  = greatest(coalesce(restricted_until, now()), _until),
           restriction_reason = _restrict
     where id = _user_id;
  end if;

  insert into public.notifications(user_id, type, title, body)
  values (_user_id, 'cancellation_strike', _title, _body);

  return jsonb_build_object('strikes', _strikes, 'restricted_until', _until);
end $function$
;

CREATE OR REPLACE FUNCTION public.escalate_overdue_disputes()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _cnt integer := 0; _d public.disputes;
BEGIN
  FOR _d IN
    SELECT * FROM public.disputes
    WHERE status IN ('open','investigating')
      AND review_due_at IS NOT NULL
      AND review_due_at < now()
      AND escalated_at IS NULL
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.disputes SET escalated_at = now() WHERE id = _d.id;

    INSERT INTO public.notifications(user_id, type, title, body)
    SELECT ur.user_id, 'dispute_overdue', 'OVERDUE: dispute needs review',
           format('A %s dispute has passed its 48-hour review window and still needs a decision.', replace(_d.category::text, '_', ' '))
    FROM public.user_roles ur
    WHERE ur.role IN ('admin','super_admin');

    _cnt := _cnt + 1;
  END LOOP;
  RETURN _cnt;
END $function$
;

CREATE OR REPLACE FUNCTION public.evidence_distance_m(_job_id uuid, _kind text)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select round((6371000 * acos(least(1, greatest(-1,
           cos(radians(e.device_lat)) * cos(radians(j.delivery_lat)) *
           cos(radians(j.delivery_lng) - radians(e.device_lng)) +
           sin(radians(e.device_lat)) * sin(radians(j.delivery_lat))
         ))))::numeric, 0)
  from public.job_evidence e
  join public.jobs j on j.id = e.job_id
  where e.job_id = _job_id and e.kind = _kind
    and e.device_lat is not null and j.delivery_lat is not null
    and e.superseded_at is null
  order by e.uploaded_at limit 1;
$function$
;

CREATE OR REPLACE FUNCTION public.expire_stale_accepted_jobs()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _cnt integer := 0; _row public.jobs;
BEGIN
  FOR _row IN
    SELECT * FROM public.jobs
    WHERE status = 'accepted'
      AND pickup_photo_taken_at IS NULL
      AND updated_at < now() - interval '24 hours'
    FOR UPDATE SKIP LOCKED
  LOOP
    PERFORM public.release_job_commission(_row.id);

    UPDATE public.jobs
       SET status = 'cancelled',
           cancellation_reason = 'Driver did not start pickup within 24 hours of accepting',
           cancellation_stage = 'post_acceptance',
           cancelled_at = now()
     WHERE id = _row.id;

    IF _row.driver_id IS NOT NULL THEN
      INSERT INTO public.cancellation_events(user_id, job_id, role, stage, reason)
      VALUES (_row.driver_id, _row.id, 'driver', 'post_acceptance', 'auto-expired: no pickup within 24h');

      INSERT INTO public.notifications(user_id, type, title, body, job_id)
      VALUES (_row.driver_id, 'job_cancelled', 'Job auto-cancelled',
              'You accepted this job but did not start pickup within 24 hours, so it was automatically cancelled.',
              _row.id);
    END IF;

    INSERT INTO public.notifications(user_id, type, title, body, job_id)
    VALUES (_row.customer_id, 'job_expired', 'Driver did not show up',
            'Your driver did not start pickup within 24 hours. This job was cancelled — you can post it again to reach other drivers.',
            _row.id);

    _cnt := _cnt + 1;
  END LOOP;
  RETURN _cnt;
END $function$
;

CREATE OR REPLACE FUNCTION public.expire_stale_dispatch_offers(_job_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  remaining integer;
  job_status text;
  waves_sent integer := 0;
BEGIN
  UPDATE public.job_dispatch_offers
     SET status = 'expired', responded_at = now()
   WHERE job_id = _job_id AND status = 'pending' AND expires_at < now();

  SELECT status INTO job_status FROM public.jobs WHERE id = _job_id;
  IF job_status <> 'open' THEN RETURN 0; END IF;

  SELECT COUNT(*) INTO remaining
  FROM public.job_dispatch_offers
  WHERE job_id = _job_id AND status = 'pending';

  IF remaining = 0 THEN
    waves_sent := public.create_dispatch_wave(_job_id, 5);
  END IF;

  RETURN waves_sent;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.expire_stale_open_jobs()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _cnt integer := 0; _row public.jobs;
BEGIN
  FOR _row IN
    SELECT * FROM public.jobs
    WHERE status = 'open'
      AND expires_at IS NOT NULL
      AND expires_at < now()
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.jobs SET status = 'cancelled' WHERE id = _row.id;

    UPDATE public.job_dispatch_offers
      SET status = 'expired', responded_at = now()
      WHERE job_id = _row.id AND status = 'pending';

    INSERT INTO public.notifications(user_id, type, title, body, job_id)
    VALUES (_row.customer_id, 'job_expired',
            'No driver responded',
            'Your ' || _row.material || ' request had no bids after 48 hours. Raise your offer or post again to reach more drivers.',
            _row.id);

    _cnt := _cnt + 1;
  END LOOP;
  RETURN _cnt;
END $function$
;

CREATE OR REPLACE FUNCTION public.get_public_tracking(_token uuid)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  j record;
  -- Plain scalars instead of a record: they default to NULL automatically
  -- when the conditional lookup below doesn't run (e.g. a completed job
  -- has no live location), unlike a `record` variable, which stays
  -- entirely unassigned and throws a hard error if any field on it is
  -- referenced later. That was crashing this function — and therefore the
  -- receipt page — for every completed job.
  _live_lat numeric;
  _live_lng numeric;
  _live_updated_at timestamptz;
begin
  select id, status, material, custom_material, quantity_m3,
         delivery_address, delivery_lat, delivery_lng, preferred_date, driver_id
    into j
    from public.jobs
   where tracking_token = _token;

  if not found then
    return null;
  end if;

  if j.status in ('accepted','in_progress') then
    select lat, lng, updated_at into _live_lat, _live_lng, _live_updated_at
      from public.driver_locations
     where job_id = j.id;
  end if;

  return json_build_object(
    'status', j.status,
    'material', j.material,
    'custom_material', j.custom_material,
    'quantity_m3', j.quantity_m3,
    'delivery_address', j.delivery_address,
    'delivery_lat', j.delivery_lat,
    'delivery_lng', j.delivery_lng,
    'preferred_date', j.preferred_date,
    'driver_name', (select full_name from public.profiles where id = j.driver_id),
    'live', case
              when _live_lat is null then null
              else json_build_object('lat', _live_lat, 'lng', _live_lng, 'updated_at', _live_updated_at)
            end
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r public.app_role; _requested text;
BEGIN
  INSERT INTO public.profiles(id, full_name, phone, email)
  VALUES (NEW.id,
          COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
          NEW.raw_user_meta_data->>'phone',
          NEW.email);

  _requested := NEW.raw_user_meta_data->>'role';
  r := CASE WHEN _requested = 'driver' THEN 'driver'::public.app_role
            ELSE 'customer'::public.app_role END;
  INSERT INTO public.user_roles(user_id, role) VALUES (NEW.id, r) ON CONFLICT DO NOTHING;

  IF r = 'driver' THEN
    INSERT INTO public.driver_profiles(user_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
    INSERT INTO public.wallets(user_id, balance) VALUES (NEW.id, 0) ON CONFLICT DO NOTHING;
  END IF;

  -- Auto-seed designated owner as super_admin + admin
  IF lower(NEW.email) = 'munesuishemichaelmashodo@gmail.com' THEN
    INSERT INTO public.user_roles(user_id, role) VALUES (NEW.id, 'super_admin') ON CONFLICT DO NOTHING;
    INSERT INTO public.user_roles(user_id, role) VALUES (NEW.id, 'admin') ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND role=_role)
$function$
;

CREATE OR REPLACE FUNCTION public.hold_job_commission(_job_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _job  public.jobs;
  _rate numeric;
  _amt  numeric;
begin
  select * into _job from public.jobs where id = _job_id for update;
  if not found then raise exception 'Job not found'; end if;

  if _job.held_commission is not null then
    return _job.held_commission;             -- already reserved
  end if;

  -- first job free: nothing to reserve
  if not coalesce(
       (select first_job_free_used from public.driver_profiles
         where user_id = _job.driver_id), false) then
    update public.jobs set held_commission = 0 where id = _job_id;
    return 0;
  end if;

  select (value::text)::numeric into _rate
    from public.system_settings where key = 'commission_rate';
  if _rate is null then raise exception 'commission_rate not configured'; end if;

  _amt := round(coalesce(_job.final_price, _job.budget, 0) * _rate / 100.0, 2);

  update public.wallets
     set held = coalesce(held, 0) + _amt, updated_at = now()
   where user_id = _job.driver_id;

  if not found then
    raise exception 'Driver % has no wallet', _job.driver_id;
  end if;

  update public.jobs set held_commission = _amt where id = _job_id;
  return _amt;
end $function$
;

CREATE OR REPLACE FUNCTION public.job_evidence_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'Evidence records cannot be deleted. Supersede instead.'
      using errcode = '42501';
  end if;

  -- only the supersede fields and notes may ever change
  if new.job_id       is distinct from old.job_id
     or new.kind         is distinct from old.kind
     or new.storage_path is distinct from old.storage_path
     or new.uploaded_by  is distinct from old.uploaded_by
     or new.uploaded_at  is distinct from old.uploaded_at
     or new.device_lat   is distinct from old.device_lat
     or new.device_lng   is distinct from old.device_lng
  then
    raise exception 'Evidence records are immutable.' using errcode = '42501';
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.jobs_block_restricted()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare _p public.profiles;
begin
  if auth.uid() is null then return new; end if;

  select * into _p from public.profiles where id = new.customer_id;
  if not found then return new; end if;

  if _p.status = 'suspended' or _p.status = 'banned' then
    raise exception 'Your account is %. Contact support.', _p.status
      using errcode = '42501';
  end if;

  if _p.restricted_until is not null and _p.restricted_until > now() then
    raise exception 'You cannot post jobs until %. Reason: %',
      to_char(_p.restricted_until at time zone 'Africa/Harare', 'DD Mon HH24:MI'),
      coalesce(_p.restriction_reason, 'repeated cancellations')
      using errcode = '42501';
  end if;

  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.jobs_guard_direct_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  _is_admin  boolean;
  _is_driver boolean;
  _is_cust   boolean;
begin
  -- SECURITY DEFINER RPCs run as owner; only PostgREST client
  -- writes arrive as authenticated/anon
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if auth.uid() is null then
    raise exception 'Not authorised to update this job.' using errcode = '42501';
  end if;

  _is_admin := public.has_role(auth.uid(), 'admin'::public.app_role)
            or public.has_role(auth.uid(), 'super_admin'::public.app_role);
  if _is_admin then return new; end if;

  _is_driver := (old.driver_id   = auth.uid());
  _is_cust   := (old.customer_id = auth.uid());

  -- ---- RPC-only, for everyone -------------------------------
  if new.status                is distinct from old.status
     or new.commission         is distinct from old.commission
     or new.final_price        is distinct from old.final_price
     or new.budget             is distinct from old.budget
     or new.driver_id          is distinct from old.driver_id
     or new.customer_id        is distinct from old.customer_id
     or new.accepted_bid_id    is distinct from old.accepted_bid_id
     or new.tracking_token     is distinct from old.tracking_token
     or new.held_commission    is distinct from old.held_commission
     or new.cancelled_at       is distinct from old.cancelled_at
     or new.cancelled_by       is distinct from old.cancelled_by
     or new.cancellation_stage is distinct from old.cancellation_stage
     or new.cancellation_reason is distinct from old.cancellation_reason
     or new.completed_at       is distinct from old.completed_at
     or new.created_at         is distinct from old.created_at
  then
    raise exception
      'This field can only be changed through the app''s job actions (accept / complete / cancel).'
      using errcode = '42501';
  end if;

  -- ---- driver: evidence only --------------------------------
  if _is_driver then
    if new.material            is distinct from old.material
       or new.custom_material  is distinct from old.custom_material
       or new.quantity_m3      is distinct from old.quantity_m3
       or new.delivery_address is distinct from old.delivery_address
       or new.dropoff_address  is distinct from old.dropoff_address
       or new.delivery_lat     is distinct from old.delivery_lat
       or new.delivery_lng     is distinct from old.delivery_lng
       or new.dropoff_lat      is distinct from old.dropoff_lat
       or new.dropoff_lng      is distinct from old.dropoff_lng
       or new.preferred_date   is distinct from old.preferred_date
       or new.expires_at       is distinct from old.expires_at
       or new.notes            is distinct from old.notes
    then
      raise exception 'Drivers may only record delivery progress, not change the order.'
        using errcode = '42501';
    end if;

    -- evidence is append-only: once set, a photo cannot be
    -- swapped or deleted from the client
    if old.pickup_photo_url is not null
       and new.pickup_photo_url is distinct from old.pickup_photo_url then
      raise exception 'The pickup photo has already been recorded and cannot be replaced.'
        using errcode = '42501';
    end if;
    if old.delivery_photo_url is not null
       and new.delivery_photo_url is distinct from old.delivery_photo_url then
      raise exception 'The delivery photo has already been recorded and cannot be replaced.'
        using errcode = '42501';
    end if;

    return new;
  end if;

  -- ---- customer ---------------------------------------------
  if _is_cust then
    if new.pickup_lat        is distinct from old.pickup_lat
       or new.pickup_lng     is distinct from old.pickup_lng
       or new.pickup_address is distinct from old.pickup_address
    then
      raise exception 'Pickup location is recorded by the driver.' using errcode = '42501';
    end if;

    if new.pickup_photo_url          is distinct from old.pickup_photo_url
       or new.delivery_photo_url     is distinct from old.delivery_photo_url
       or new.pickup_photo_taken_at  is distinct from old.pickup_photo_taken_at
       or new.delivery_photo_taken_at is distinct from old.delivery_photo_taken_at
       or new.delivered_quantity_m3  is distinct from old.delivered_quantity_m3
       or new.receiver_name          is distinct from old.receiver_name
    then
      raise exception 'Delivery evidence is recorded by the driver.' using errcode = '42501';
    end if;

    if old.status <> 'open' then
      if new.material            is distinct from old.material
         or new.custom_material  is distinct from old.custom_material
         or new.quantity_m3      is distinct from old.quantity_m3
         or new.delivery_address is distinct from old.delivery_address
         or new.dropoff_address  is distinct from old.dropoff_address
         or new.delivery_lat     is distinct from old.delivery_lat
         or new.delivery_lng     is distinct from old.delivery_lng
         or new.dropoff_lat      is distinct from old.dropoff_lat
         or new.dropoff_lng      is distinct from old.dropoff_lng
         or new.preferred_date   is distinct from old.preferred_date
      then
        raise exception 'This job has been accepted — cancel it to change the order.'
          using errcode = '42501';
      end if;
    end if;
    return new;
  end if;

  raise exception 'Not authorised to update this job.' using errcode = '42501';
end $function$
;

CREATE OR REPLACE FUNCTION public.jobs_stamp_photo_times()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
begin
  if new.pickup_photo_url is not null
     and old.pickup_photo_url is null then
    new.pickup_photo_taken_at := now();
  end if;
  if new.delivery_photo_url is not null
     and old.delivery_photo_url is null then
    new.delivery_photo_taken_at := now();
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.log_admin_action(_action text, _meta jsonb DEFAULT '{}'::jsonb, _reason text DEFAULT NULL::text, _target_id uuid DEFAULT NULL::uuid, _target_user uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
begin
  insert into public.admin_audit_log
    (actor_id, action, target_user_id, target_id, reason, meta)
  values
    (auth.uid(), _action, _target_user, _target_id, _reason,
     coalesce(_meta, '{}'::jsonb));
end $function$
;

CREATE OR REPLACE FUNCTION public.log_evidence_access(_evidence_id uuid, _purpose text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare _ev public.job_evidence; _job public.jobs;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;

  select * into _ev from public.job_evidence where id = _evidence_id;
  if not found then raise exception 'Evidence not found'; end if;

  select * into _job from public.jobs where id = _ev.job_id;

  if _job.customer_id <> auth.uid() and _job.driver_id <> auth.uid()
     and not (public.has_role(auth.uid(), 'admin'::public.app_role)
           or public.has_role(auth.uid(), 'super_admin'::public.app_role)) then
    raise exception 'Not authorised to view this evidence';
  end if;

  insert into public.evidence_access_log(evidence_id, job_id, viewer_id, purpose)
  values (_evidence_id, _ev.job_id, auth.uid(), _purpose);

  return _ev.storage_path;
end $function$
;

CREATE OR REPLACE FUNCTION public.mark_escrow_payment_paid(_payment_id uuid)
 RETURNS payments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _p public.payments;
BEGIN
  SELECT * INTO _p FROM public.payments WHERE id = _payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found'; END IF;
  IF _p.type <> 'escrow' THEN RAISE EXCEPTION 'Payment % is not an escrow hold', _payment_id; END IF;

  -- idempotent
  IF _p.status = 'paid' THEN RETURN _p; END IF;

  UPDATE public.payments SET status = 'paid', updated_at = now() WHERE id = _payment_id RETURNING * INTO _p;

  IF _p.job_id IS NOT NULL THEN
    INSERT INTO public.notifications(user_id, type, title, body, job_id)
    SELECT j.driver_id, 'escrow_funded', 'Payment received — you''re clear to deliver',
           'The customer paid through Con Z Pay. Funds are held safely and will be released to you once delivery is confirmed.',
           j.id
    FROM public.jobs j WHERE j.id = _p.job_id AND j.driver_id IS NOT NULL;
  END IF;

  RETURN _p;
END $function$
;

CREATE OR REPLACE FUNCTION public.mark_messages_read(_job_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _job public.jobs; _cnt integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  SELECT * INTO _job FROM public.jobs WHERE id = _job_id;
  IF _job IS NULL THEN RAISE EXCEPTION 'Job not found'; END IF;
  IF auth.uid() <> _job.customer_id AND auth.uid() <> _job.driver_id THEN
    RAISE EXCEPTION 'Not part of this job';
  END IF;

  UPDATE public.messages
     SET read_at = now()
   WHERE job_id = _job_id AND sender_id <> auth.uid() AND read_at IS NULL;
  GET DIAGNOSTICS _cnt = ROW_COUNT;
  RETURN _cnt;
END $function$
;

CREATE OR REPLACE FUNCTION public.mark_spotlight_seen(_key text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  UPDATE public.profiles
     SET spotlights_seen = spotlights_seen || jsonb_build_object(_key, true)
   WHERE id = auth.uid();
END $function$
;

CREATE OR REPLACE FUNCTION public.public_material_pickups()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT coalesce(jsonb_object_agg(material, jsonb_build_object(
           'lat', pickup_lat, 'lng', pickup_lng, 'label', pickup_label
         )), '{}'::jsonb)
  FROM public.material_prices
  WHERE pickup_lat IS NOT NULL AND pickup_lng IS NOT NULL;
$function$
;


CREATE OR REPLACE FUNCTION public.raise_dispute(_job_id uuid, _against uuid, _category text, _reason text)
 RETURNS disputes
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  _job public.jobs;
  _d   public.disputes;
  _cat public.dispute_category;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;

  if _reason is null or length(trim(_reason)) < 10 then
    raise exception 'Please describe the problem in at least 10 characters';
  end if;

  begin
    _cat := _category::public.dispute_category;
  exception when others then
    raise exception 'Unknown dispute category: %', _category;
  end;

  select * into _job from public.jobs where id = _job_id;
  if not found then raise exception 'Job not found'; end if;

  -- only a party to the job
  if auth.uid() <> _job.customer_id and auth.uid() <> _job.driver_id then
    raise exception 'You are not part of this job';
  end if;

  -- the other party, if not supplied
  if _against is null then
    _against := case when auth.uid() = _job.customer_id
                     then _job.driver_id else _job.customer_id end;
  end if;

  if _against = auth.uid() then
    raise exception 'You cannot raise a dispute against yourself';
  end if;

  -- can't dispute a job that never started
  if _job.status = 'open' then
    raise exception 'This job has not been accepted yet';
  end if;

  -- one open dispute per job per person
  if exists (select 1 from public.disputes
              where job_id = _job_id and raised_by = auth.uid()
                and status in ('open','investigating')) then
    raise exception 'You already have an open dispute on this job';
  end if;

  insert into public.disputes
    (job_id, raised_by, against, category, reason, status, review_due_at)
  values
    (_job_id, auth.uid(), _against, _cat, trim(_reason), 'open',
     now() + interval '48 hours')
  returning * into _d;

  -- notify the other party
  insert into public.notifications(user_id, type, title, body)
  values (_against, 'dispute_raised', 'A dispute was raised',
          format('A dispute (%s) was raised on one of your jobs. Con Z will review it.',
                 replace(_cat::text, '_', ' ')));

  -- notify admins
  insert into public.notifications(user_id, type, title, body)
  select ur.user_id, 'dispute_raised', 'New dispute needs review',
         format('Category: %s. Due within 48h.', replace(_cat::text, '_', ' '))
  from public.user_roles ur
  where ur.role in ('admin','super_admin');

  return _d;
end $function$
;

CREATE OR REPLACE FUNCTION public.recent_cancellation_strikes(_user_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select count(*)::int
  from public.cancellation_events
  where user_id = _user_id
    and waived_at is null
    and created_at > now() - interval '90 days';
$function$
;

CREATE OR REPLACE FUNCTION public.record_job_evidence(_job_id uuid, _kind text, _storage_path text, _file_size bigint DEFAULT NULL::bigint, _mime_type text DEFAULT NULL::text, _lat double precision DEFAULT NULL::double precision, _lng double precision DEFAULT NULL::double precision, _accuracy_m numeric DEFAULT NULL::numeric, _location_status text DEFAULT 'unknown'::text)
 RETURNS job_evidence
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  _job public.jobs;
  _ev  public.job_evidence;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if _kind not in ('pickup','delivery','dispute','other') then
    raise exception 'Invalid evidence kind: %', _kind;
  end if;

  select * into _job from public.jobs where id = _job_id for update;
  if not found then raise exception 'Job not found'; end if;

  if _job.driver_id <> auth.uid()
     and _job.customer_id <> auth.uid()
     and not (public.has_role(auth.uid(), 'admin'::public.app_role)
           or public.has_role(auth.uid(), 'super_admin'::public.app_role)) then
    raise exception 'Not part of this job';
  end if;

  -- path must sit under the job id — same rule the storage
  -- policies enforce
  if split_part(_storage_path, '/', 1) <> _job_id::text then
    raise exception 'Evidence path must start with the job id';
  end if;

  insert into public.job_evidence
    (job_id, kind, storage_path, uploaded_by, file_size, mime_type,
     device_lat, device_lng, device_accuracy_m, location_status)
  values
    (_job_id, _kind, _storage_path, auth.uid(), _file_size, _mime_type,
     _lat, _lng, _accuracy_m,
     coalesce(_location_status, case when _lat is not null then 'captured'
                                     else 'unknown' end))
  returning * into _ev;

  -- point the jobs row at the FIRST photo of each kind only;
  -- later ones are recorded but do not replace it
  if _kind = 'pickup' and _job.pickup_photo_url is null then
    update public.jobs
       set pickup_photo_url = _storage_path,
           pickup_lat = coalesce(_lat, pickup_lat),
           pickup_lng = coalesce(_lng, pickup_lng)
     where id = _job_id;
  elsif _kind = 'delivery' and _job.delivery_photo_url is null then
    update public.jobs
       set delivery_photo_url = _storage_path,
           delivery_lat = coalesce(_lat, delivery_lat),
           delivery_lng = coalesce(_lng, delivery_lng)
     where id = _job_id;
  end if;

  return _ev;
end $function$
;

CREATE OR REPLACE FUNCTION public.reject_counter(_bid_id uuid)
 RETURNS bids
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _bid public.bids;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;

  SELECT * INTO _bid FROM public.bids WHERE id = _bid_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bid not found'; END IF;
  IF _bid.driver_id <> auth.uid() THEN RAISE EXCEPTION 'Not your bid'; END IF;
  IF _bid.counter_status <> 'countered' THEN RAISE EXCEPTION 'No pending counter-offer on this bid'; END IF;

  UPDATE public.bids SET counter_status = 'driver_rejected' WHERE id = _bid_id RETURNING * INTO _bid;

  INSERT INTO public.notifications(user_id, type, title, body, job_id)
  SELECT j.customer_id, 'bid_countered', 'Driver declined your counter-offer',
         format('Their original price of $%s still stands if you''d like to accept it.', _bid.price::text), j.id
  FROM public.jobs j WHERE j.id = _bid.job_id;

  RETURN _bid;
END $function$
;

CREATE OR REPLACE FUNCTION public.release_escrow_and_complete(_job_id uuid, _actor uuid)
 RETURNS jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _job public.jobs; _payment public.payments; _rate numeric; _commission numeric;
  _payout numeric; _new_bal numeric; _free_used boolean; _has_profile boolean; _level driver_level;
BEGIN
  SELECT * INTO _job FROM public.jobs WHERE id = _job_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Job not found'; END IF;
  IF _job.payment_method <> 'escrow' THEN RAISE EXCEPTION 'Job % is not an escrow job', _job_id; END IF;
  IF _job.status NOT IN ('accepted', 'in_progress') THEN RAISE EXCEPTION 'Job not in progress'; END IF;

  SELECT * INTO _payment FROM public.payments
    WHERE job_id = _job_id AND type = 'escrow' AND status = 'paid'
    ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No confirmed escrow payment for this job yet'; END IF;

  SELECT (value::text)::numeric INTO _rate FROM public.system_settings WHERE key = 'commission_rate';
  IF _rate IS NULL THEN RAISE EXCEPTION 'commission_rate not configured'; END IF;

  SELECT first_job_free_used, true, level INTO _free_used, _has_profile, _level
    FROM public.driver_profiles WHERE user_id = _job.driver_id;
  IF NOT COALESCE(_has_profile, false) THEN
    RAISE EXCEPTION 'Driver profile missing for driver %', _job.driver_id;
  END IF;

  IF _free_used IS NOT TRUE THEN
    _commission := 0;
    UPDATE public.driver_profiles SET first_job_free_used = true WHERE user_id = _job.driver_id;
  ELSE
    _commission := round(_payment.amount * _rate / 100.0
                          * public.driver_level_commission_multiplier(_level), 2);
  END IF;
  _payout := _payment.amount - _commission;

  INSERT INTO public.wallets(user_id, balance) VALUES (_job.driver_id, 0) ON CONFLICT (user_id) DO NOTHING;

  UPDATE public.wallets SET balance = balance + _payout, updated_at = now(), limited = false
   WHERE user_id = _job.driver_id RETURNING balance INTO _new_bal;

  INSERT INTO public.wallet_transactions(user_id, type, amount, balance_after, job_id, note, created_by)
  VALUES (_job.driver_id, 'topup', _payout, _new_bal, _job.id,
          format('Con Z Pay escrow release — %s%% commission already deducted (%s tier)', _rate, _level), _actor);

  UPDATE public.payments SET status = 'released', updated_at = now() WHERE id = _payment.id;

  UPDATE public.driver_profiles SET jobs_completed = jobs_completed + 1 WHERE user_id = _job.driver_id;

  UPDATE public.jobs
     SET status = 'completed', commission = _commission, completed_at = now()
   WHERE id = _job_id
  RETURNING * INTO _job;

  IF to_regprocedure('public.issue_pod(uuid)') IS NOT NULL THEN
    PERFORM public.issue_pod(_job_id);
  END IF;

  INSERT INTO public.notifications(user_id, type, title, body, job_id)
  VALUES (_job.driver_id, 'escrow_released', 'Payment released to you!',
          format('$%s has been added to your wallet for this delivery.', _payout::text), _job.id);

  RETURN _job;
END $function$
;

CREATE OR REPLACE FUNCTION public.release_job_commission(_job_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _job public.jobs;
  _amt numeric;
begin
  select * into _job from public.jobs where id = _job_id;
  if not found then return 0; end if;

  _amt := coalesce(_job.held_commission, 0);
  if _amt = 0 or _job.driver_id is null then
    update public.jobs set held_commission = null where id = _job_id;
    return 0;
  end if;

  -- greatest(...,0) so a double release can never push held negative
  update public.wallets
     set held = greatest(coalesce(held, 0) - _amt, 0), updated_at = now()
   where user_id = _job.driver_id;

  update public.jobs set held_commission = null where id = _job_id;
  return _amt;
end $function$
;

CREATE OR REPLACE FUNCTION public.request_topup(_amount numeric, _method text, _reference text)
 RETURNS wallet_topup_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _r public.wallet_topup_requests; _pending int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  IF _amount IS NULL OR _amount <= 0 OR _amount > 100000 THEN
    RAISE EXCEPTION 'Amount must be between $1 and $100,000';
  END IF;
  IF _method NOT IN ('ecocash','onemoney','zipit','bank') THEN
    RAISE EXCEPTION 'Invalid payment method';
  END IF;
  SELECT COUNT(*) INTO _pending FROM public.wallet_topup_requests
    WHERE user_id = auth.uid() AND status = 'pending';
  IF _pending >= 5 THEN RAISE EXCEPTION 'Too many pending top-ups. Cancel one first.'; END IF;

  INSERT INTO public.wallet_topup_requests(user_id, amount, method, reference)
    VALUES (auth.uid(), ROUND(_amount,2), _method, NULLIF(trim(_reference),''))
    RETURNING * INTO _r;

  INSERT INTO public.wallet_audit_log(user_id, actor_id, action, meta)
  VALUES (auth.uid(), auth.uid(), 'topup_requested',
          jsonb_build_object('id',_r.id,'amount',_r.amount,'method',_r.method));
  RETURN _r;
END $function$
;

CREATE OR REPLACE FUNCTION public.request_withdrawal(_amount numeric, _method text, _destination text, _pin text)
 RETURNS wallet_withdrawal_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  _r public.wallet_withdrawal_requests;
  _bal numeric; _held numeric; _avail numeric;
  _limited boolean; _hash text; _att public.pin_attempts;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if _amount is null or _amount <= 0 or _amount > 100000 then
    raise exception 'Invalid amount';
  end if;
  if _method not in ('ecocash','onemoney','zipit','bank') then
    raise exception 'Invalid method';
  end if;
  if _destination is null or length(trim(_destination)) < 4 then
    raise exception 'Destination required';
  end if;

  -- FIX #13: one pending request at a time
  if exists (select 1 from public.wallet_withdrawal_requests
              where user_id = auth.uid() and status = 'pending') then
    raise exception 'You already have a withdrawal awaiting approval';
  end if;

  select * into _att from public.pin_attempts where user_id = auth.uid();
  if _att.locked_until is not null and _att.locked_until > now() then
    raise exception 'Too many wrong PINs. Try again later.';
  end if;

  select withdrawal_pin_hash into _hash
    from public.driver_profiles where user_id = auth.uid();
  if _hash is null then
    raise exception 'Set a withdrawal PIN in Profile first';
  end if;

  if crypt(coalesce(_pin,''), _hash) <> _hash then
    insert into public.pin_attempts(user_id, fail_count) values (auth.uid(), 1)
    on conflict (user_id) do update
      set fail_count = public.pin_attempts.fail_count + 1,
          locked_until = case when public.pin_attempts.fail_count + 1 >= 5
                              then now() + interval '15 minutes' else null end,
          updated_at = now();
    insert into public.wallet_audit_log(user_id, actor_id, action, meta)
      values (auth.uid(), auth.uid(), 'pin_failed', '{}'::jsonb);
    raise exception 'Wrong PIN';
  end if;

  update public.pin_attempts
     set fail_count = 0, locked_until = null, updated_at = now()
   where user_id = auth.uid();

  select coalesce(balance,0), coalesce(held,0), coalesce(limited,false)
    into _bal, _held, _limited
    from public.wallets where user_id = auth.uid();

  -- FIX #15
  if coalesce(_limited, false) then
    raise exception 'Your wallet is limited. Contact support.';
  end if;

  -- FIX #10: spendable, not raw balance
  _avail := coalesce(_bal,0) - coalesce(_held,0);
  if _avail < _amount then
    raise exception 'Insufficient available balance. $% is reserved against active jobs.',
      coalesce(_held,0)::text;
  end if;

  insert into public.wallet_withdrawal_requests(user_id, amount, method, destination)
    values (auth.uid(), round(_amount,2), _method, trim(_destination))
    returning * into _r;

  insert into public.wallet_audit_log(user_id, actor_id, action, meta)
    values (auth.uid(), auth.uid(), 'withdrawal_requested',
            jsonb_build_object('id', _r.id, 'amount', _r.amount,
                               'method', _r.method, 'held', _held));
  return _r;
end $function$
;

CREATE OR REPLACE FUNCTION public.resolve_dispute(_dispute_id uuid, _outcome text, _resolution text)
 RETURNS disputes
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  _d       public.disputes;
  _job     public.jobs;
  _out     public.dispute_outcome;
  _amount  numeric;
  _new_bal numeric;
begin
  if not (public.has_role(auth.uid(), 'admin'::public.app_role)
       or public.has_role(auth.uid(), 'super_admin'::public.app_role)) then
    raise exception 'Forbidden';
  end if;

  begin
    _out := _outcome::public.dispute_outcome;
  exception when others then
    raise exception 'Unknown outcome: %', _outcome;
  end;

  select * into _d from public.disputes where id = _dispute_id for update;
  if not found then raise exception 'Dispute not found'; end if;
  if _d.status = 'resolved' then raise exception 'Already resolved'; end if;

  select * into _job from public.jobs where id = _d.job_id;

  -- ---- apply the outcome ------------------------------------
  if _out = 'refund' then
    -- refund the customer the commission Con Z took, credited to
    -- their wallet. Driver's earnings are not clawed back — that
    -- is a separate decision and should be explicit.
    _amount := coalesce(_job.commission, 0);
    if _amount > 0 then
      insert into public.wallets(user_id, balance)
      values (_job.customer_id, 0)
      on conflict (user_id) do nothing;

      update public.wallets
         set balance = balance + _amount, updated_at = now()
       where user_id = _job.customer_id
      returning balance into _new_bal;

      insert into public.wallet_transactions
        (user_id, type, amount, balance_after, job_id, note, created_by)
      values (_job.customer_id, 'refund', _amount, _new_bal, _job.id,
              format('Dispute refund (%s)', _d.category), auth.uid());
    end if;

  elsif _out = 'strike_issued' then
    insert into public.cancellation_events(user_id, job_id, role, stage, reason)
    values (_d.against, _d.job_id,
            case when _d.against = _job.driver_id then 'driver' else 'customer' end,
            'dispute', format('Dispute upheld: %s', _d.category));

    update public.profiles
       set cancellation_strikes = public.recent_cancellation_strikes(_d.against)
     where id = _d.against;

  elsif _out = 'account_suspended' then
    update public.profiles set status = 'suspended' where id = _d.against;

  elsif _out = 'fee_waived' then
    -- release any commission still held against this job
    perform public.release_job_commission(_d.job_id);
  end if;

  update public.disputes
     set status      = 'resolved',
         outcome     = _out,
         resolution  = _resolution,
         resolved_at = now(),
         resolved_by = auth.uid()
   where id = _dispute_id
  returning * into _d;

  perform public.log_admin_action(
    'dispute_resolved',
    jsonb_build_object('dispute_id', _dispute_id, 'outcome', _out,
                       'job_id', _d.job_id),
    _resolution, _dispute_id, _d.against);

  insert into public.notifications(user_id, type, title, body)
  select u, 'dispute_resolved', 'Dispute resolved', _resolution
  from unnest(array[_d.raised_by, _d.against]) as u
  where u is not null;

  return _d;
end $function$
;

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
begin
  new.updated_at = now();
  return new;
end;$function$
;

CREATE OR REPLACE FUNCTION public.set_withdrawal_pin(_pin text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  IF _pin IS NULL OR length(_pin) < 4 OR length(_pin) > 8 OR _pin !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'PIN must be 4-8 digits';
  END IF;
  INSERT INTO public.driver_profiles (user_id, withdrawal_pin_hash)
    VALUES (auth.uid(), crypt(_pin, gen_salt('bf')))
    ON CONFLICT (user_id) DO UPDATE SET withdrawal_pin_hash = EXCLUDED.withdrawal_pin_hash;
  INSERT INTO public.pin_attempts(user_id, fail_count) VALUES (auth.uid(),0)
    ON CONFLICT (user_id) DO UPDATE SET fail_count=0, locked_until=NULL, updated_at=now();
  INSERT INTO public.wallet_audit_log(user_id,actor_id,action,meta)
    VALUES (auth.uid(),auth.uid(),'pin_set','{}'::jsonb);
END $function$
;

CREATE OR REPLACE FUNCTION public.start_trip(_job_id uuid)
 RETURNS jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare _job public.jobs;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;

  select * into _job from public.jobs where id = _job_id for update;
  if not found then raise exception 'Job not found'; end if;

  if _job.driver_id <> auth.uid() then
    raise exception 'Only the assigned driver can start this trip';
  end if;

  if _job.status = 'in_progress' then
    return _job;                                  -- idempotent
  end if;

  if _job.status <> 'accepted' then
    raise exception 'Cannot start a trip on a % job', _job.status;
  end if;

  -- the pickup photo IS the start condition
  if _job.pickup_photo_url is null then
    raise exception 'Upload the pickup photo before starting the trip';
  end if;

  update public.jobs set status = 'in_progress' where id = _job_id
  returning * into _job;

  insert into public.notifications(user_id, type, title, body)
  values (_job.customer_id, 'job_started', 'Your delivery is on the way',
          'The driver has loaded and started the trip.');

  return _job;
end $function$
;

CREATE OR REPLACE FUNCTION public.storage_protect_evidence()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'storage'
AS $function$
declare _is_admin boolean;
begin
  if coalesce(old.bucket_id, new.bucket_id) <> 'job-proof-photos' then
    return coalesce(new, old);
  end if;

  -- service role / SQL editor
  if current_user not in ('authenticated', 'anon') then
    return coalesce(new, old);
  end if;

  _is_admin := public.has_role(auth.uid(), 'admin'::public.app_role)
            or public.has_role(auth.uid(), 'super_admin'::public.app_role);
  if _is_admin then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    raise exception 'Delivery photos cannot be deleted.' using errcode = '42501';
  end if;

  -- this is what { upsert: true } does on an existing object
  if tg_op = 'UPDATE' then
    raise exception 'This photo has already been recorded and cannot be replaced.'
      using errcode = '42501';
  end if;

  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.sweep_stalled_dispatch_offers()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r record;
begin
  for r in
    select id from public.jobs where status = 'open'
  loop
    perform public.expire_stale_dispatch_offers(r.id);
  end loop;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tg_check_location_anomaly()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_status public.job_status;
  v_moved_meters double precision;
  v_stationary_minutes integer;
  v_threshold_minutes constant integer := 20;
  v_move_threshold_meters constant double precision := 100;
BEGIN
  SELECT status INTO v_status FROM public.jobs WHERE id = NEW.job_id;

  IF TG_OP = 'INSERT' THEN
    NEW.stationary_since := NEW.updated_at;
    NEW.anomaly_alerted_at := NULL;
    RETURN NEW;
  END IF;

  IF v_status IS DISTINCT FROM 'in_progress' THEN
    NEW.stationary_since := NULL;
    NEW.anomaly_alerted_at := NULL;
    RETURN NEW;
  END IF;

  v_moved_meters := 111320 * sqrt(
    power(NEW.lat - OLD.lat, 2) +
    power((NEW.lng - OLD.lng) * cos(radians(NEW.lat)), 2)
  );

  IF v_moved_meters > v_move_threshold_meters OR OLD.stationary_since IS NULL THEN
    -- Actually moved (or just entered in_progress) — (re)start the clock.
    NEW.stationary_since := NEW.updated_at;
    NEW.anomaly_alerted_at := NULL;
    RETURN NEW;
  END IF;

  -- Still roughly in the same spot as last ping — keep the original
  -- stationary_since so the clock doesn't reset on every 5-second ping.
  NEW.stationary_since := OLD.stationary_since;
  v_stationary_minutes := GREATEST(0, EXTRACT(EPOCH FROM (NEW.updated_at - NEW.stationary_since)) / 60)::integer;

  IF v_stationary_minutes >= v_threshold_minutes AND OLD.anomaly_alerted_at IS NULL THEN
    NEW.anomaly_alerted_at := NEW.updated_at;

    INSERT INTO public.location_anomalies (job_id, driver_id, kind, lat, lng, stationary_minutes)
    VALUES (NEW.job_id, NEW.driver_id, 'long_stop', NEW.lat, NEW.lng, v_stationary_minutes);

    INSERT INTO public.notifications (user_id, type, title, body, job_id)
    SELECT j.customer_id, 'delivery_stopped',
           'Your delivery hasn''t moved in a while',
           'Your driver has been stationary for about ' || v_stationary_minutes || ' minutes. Tap to check the job.',
           j.id
    FROM public.jobs j WHERE j.id = NEW.job_id;

    INSERT INTO public.notifications (user_id, type, title, body, job_id)
    SELECT ur.user_id, 'delivery_stopped',
           'Driver stationary during delivery',
           'A driver has been stationary for about ' || v_stationary_minutes || ' minutes on an in-progress job.',
           NEW.job_id
    FROM public.user_roles ur WHERE ur.role IN ('admin','super_admin');
  ELSE
    NEW.anomaly_alerted_at := OLD.anomaly_alerted_at;
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.tg_customer_rating_aggregate()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE _avg numeric; _cnt int;
BEGIN
  SELECT ROUND(AVG(overall)::numeric, 2), COUNT(*)
    INTO _avg, _cnt FROM public.customer_ratings WHERE customer_id = NEW.customer_id;
  UPDATE public.profiles SET customer_rating_avg = _avg, customer_rating_count = _cnt WHERE id = NEW.customer_id;
  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.tg_driver_level()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.level := CASE
    WHEN NEW.jobs_completed >= 500 THEN 'platinum'::public.driver_level
    WHEN NEW.jobs_completed >= 101 THEN 'gold'::public.driver_level
    WHEN NEW.jobs_completed >= 21  THEN 'silver'::public.driver_level
    ELSE 'bronze'::public.driver_level
  END;
  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.tg_flag_contact_sharing()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _pattern text; _cnt int;
BEGIN
  IF NEW.body IS NULL THEN RETURN NEW; END IF;

  -- Zimbabwean-style phone number (07xx xxx xxx / +263 7x xxx xxxx / 263...)
  IF NEW.body ~ '(\+?263|0)7[0-9][ -]?[0-9]{3}[ -]?[0-9]{3,4}' THEN
    _pattern := 'phone_number';
  ELSIF NEW.body ~* '(whats\s*app|call me|text me|my number|off\s*the\s*app|outside\s*the\s*app|cash\s*only|pay\s*me\s*direct)' THEN
    _pattern := 'contact_keyword';
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.chat_flags(message_id, job_id, sender_id, pattern_type, snippet)
  VALUES (NEW.id, NEW.job_id, NEW.sender_id, _pattern, left(NEW.body, 140));

  SELECT count(*) INTO _cnt FROM public.chat_flags WHERE job_id = NEW.job_id;

  -- Notify admins once this job crosses 2 flags — a single mention is very
  -- often an address or gate code, a repeated pattern is the real signal.
  IF _cnt = 2 THEN
    INSERT INTO public.notifications(user_id, type, title, body, job_id)
    SELECT ur.user_id, 'chat_flagged', 'Possible off-platform contact attempt',
           'Repeated phone number or contact-sharing language detected in a job chat. Review recommended.',
           NEW.job_id
    FROM public.user_roles ur WHERE ur.role IN ('admin','super_admin');
  END IF;

  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.tg_generate_delivery_pin()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.payment_method = 'escrow' AND NEW.status = 'accepted'
     AND (OLD.status IS DISTINCT FROM 'accepted')
     AND NEW.delivery_pin IS NULL THEN
    NEW.delivery_pin := lpad(floor(random() * 1000000)::text, 6, '0');
  END IF;
  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.tg_notify_bid_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _job public.jobs;
BEGIN
  IF NEW.status = 'accepted' AND OLD.status IS DISTINCT FROM 'accepted' THEN
    SELECT * INTO _job FROM public.jobs WHERE id = NEW.job_id;
    INSERT INTO public.notifications(user_id, type, title, body, job_id)
    VALUES (NEW.driver_id, 'bid_accepted',
            'Your bid was accepted!',
            'You won the ' || _job.material || ' job for $' || NEW.price::text,
            NEW.job_id);
  END IF;
  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.tg_notify_bid_submitted()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _job public.jobs; _driver_name TEXT;
BEGIN
  SELECT * INTO _job FROM public.jobs WHERE id = NEW.job_id;
  SELECT full_name INTO _driver_name FROM public.profiles WHERE id = NEW.driver_id;
  INSERT INTO public.notifications(user_id, type, title, body, job_id)
  VALUES (_job.customer_id, 'bid_submitted',
          'New bid on your job',
          COALESCE(_driver_name,'A driver') || ' bid $' || NEW.price::text || ' on ' || _job.material,
          NEW.job_id);
  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.tg_notify_job_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'in_progress' AND OLD.status IS DISTINCT FROM 'in_progress' THEN
    INSERT INTO public.notifications(user_id, type, title, body, job_id)
    VALUES (NEW.customer_id, 'tracking_started',
            'Driver is on the way',
            'Live tracking has started for your ' || NEW.material || ' delivery',
            NEW.id);
  END IF;
  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    INSERT INTO public.notifications(user_id, type, title, body, job_id)
    VALUES (NEW.customer_id, 'job_completed',
            'Job completed',
            'Your ' || NEW.material || ' delivery is marked complete',
            NEW.id);
    IF NEW.driver_id IS NOT NULL THEN
      INSERT INTO public.notifications(user_id, type, title, body, job_id)
      VALUES (NEW.driver_id, 'job_completed',
              'Job completed',
              'Job marked complete. Commission $' || COALESCE(NEW.commission,0)::text || ' applied.',
              NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.tg_notify_new_job_posted()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.status = 'open' then
    insert into public.notifications (user_id, type, title, body, job_id)
    select
      ur.user_id,
      'new_job',
      'New job available',
      coalesce(new.quantity_m3::text || 'm³ ', '') || coalesce(new.material::text, 'Material') ||
        ' delivery to ' || coalesce(new.dropoff_address, new.delivery_address, 'a nearby location'),
      new.id
    from public.user_roles ur
    join public.driver_profiles dp on dp.user_id = ur.user_id
    where ur.role = 'driver'
      and dp.verification_status = 'verified'
      and (dp.reverify_due_at is null or dp.reverify_due_at > now());
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tg_notify_new_message()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _job public.jobs; _recipient uuid; _sender_name text;
BEGIN
  SELECT * INTO _job FROM public.jobs WHERE id = NEW.job_id;
  IF _job IS NULL THEN RETURN NEW; END IF;

  _recipient := CASE WHEN NEW.sender_id = _job.customer_id THEN _job.driver_id ELSE _job.customer_id END;
  IF _recipient IS NULL THEN RETURN NEW; END IF;

  SELECT full_name INTO _sender_name FROM public.profiles WHERE id = NEW.sender_id;

  INSERT INTO public.notifications(user_id, type, title, body, job_id)
  VALUES (
    _recipient,
    'new_message',
    format('New message from %s', COALESCE(_sender_name, 'the other party')),
    COALESCE(left(NEW.body, 140), 'Sent a photo'),
    NEW.job_id
  );

  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.tg_notify_new_report()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.notifications(user_id, type, title, body)
  SELECT ur.user_id, 'report_filed', 'New report submitted',
         left(NEW.description, 140)
  FROM public.user_roles ur
  WHERE ur.role IN ('admin','super_admin');
  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.tg_notify_preferred_driver()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'open' AND NEW.preferred_driver_id IS NOT NULL THEN
    INSERT INTO public.notifications(user_id, type, title, body, job_id)
    VALUES (NEW.preferred_driver_id, 'repeat_customer',
            'A past customer wants to book you again!',
            'They specifically requested you for this delivery — bid first to lock it in.',
            NEW.id);
  END IF;
  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.tg_rating_aggregate()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE _avg NUMERIC; _cnt INT;
BEGIN
  SELECT ROUND(AVG((quality+communication+reliability+delivery_time)/4.0)::numeric,2), COUNT(*)
    INTO _avg, _cnt FROM public.ratings WHERE driver_id=NEW.driver_id;
  UPDATE public.driver_profiles SET rating_avg=_avg, rating_count=_cnt WHERE user_id=NEW.driver_id;
  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.tg_send_push_on_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  PERFORM net.http_post(
    url := 'https://ovwrsocjmkpiygipmrdk.supabase.co/functions/v1/send-push',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object(
      'user_id', NEW.user_id,
      'title', NEW.title,
      'body', COALESCE(NEW.body, ''),
      'notification_id', NEW.id,
      'job_id', NEW.job_id
    )
  );
  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.tg_touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN NEW.updated_at = now(); RETURN NEW; END $function$
;

CREATE OR REPLACE FUNCTION public.tg_validate_job_budget()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  _mp public.material_prices;
  _distance_km numeric;
  _offer jsonb;
  _min numeric;
  _max numeric;
BEGIN
  SELECT * INTO _mp FROM public.material_prices WHERE material = NEW.material;
  IF _mp IS NULL OR NOT _mp.enforced THEN RETURN NEW; END IF;
  IF NEW.budget IS NULL THEN RETURN NEW; END IF;

  IF NEW.pickup_lat IS NOT NULL AND NEW.pickup_lng IS NOT NULL
     AND NEW.delivery_lat IS NOT NULL AND NEW.delivery_lng IS NOT NULL THEN
    _distance_km := 2 * 6371 * asin(sqrt(
      power(sin(radians(NEW.delivery_lat - NEW.pickup_lat) / 2), 2) +
      cos(radians(NEW.pickup_lat)) * cos(radians(NEW.delivery_lat)) *
      power(sin(radians(NEW.delivery_lng - NEW.pickup_lng) / 2), 2)
    ));
  ELSE
    _distance_km := 15;
  END IF;

  _offer := public.compute_material_offer(NEW.material, NEW.quantity_m3, _distance_km);

  IF (_offer->>'enforced')::boolean IS NOT TRUE THEN RETURN NEW; END IF;
  IF _offer->>'min' IS NULL OR _offer->>'max' IS NULL THEN RETURN NEW; END IF;

  _min := (_offer->>'min')::numeric;
  _max := (_offer->>'max')::numeric;

  IF NEW.budget < _min OR NEW.budget > _max THEN
    RAISE EXCEPTION 'Budget $% is outside the allowed range for % ($%-$% for % m³ at ~%km)',
      NEW.budget, _mp.label, _min, _max, NEW.quantity_m3, round(_distance_km);
  END IF;
  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.trigger_initial_dispatch()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'open' THEN
    PERFORM public.create_dispatch_wave(NEW.id, 5);
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.wallet_available(_user_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(balance, 0) - coalesce(held, 0)
  from public.wallets where user_id = _user_id;
$function$
;



-- -----------------------------------------------------------------------------
-- Triggers
-- -----------------------------------------------------------------------------
CREATE OR REPLACE TRIGGER trg_bids_guard_direct_write BEFORE UPDATE ON public.bids FOR EACH ROW EXECUTE FUNCTION bids_guard_direct_write();
CREATE OR REPLACE TRIGGER trg_notify_bid_status AFTER UPDATE ON public.bids FOR EACH ROW EXECUTE FUNCTION tg_notify_bid_status();
CREATE OR REPLACE TRIGGER trg_notify_bid_submitted AFTER INSERT ON public.bids FOR EACH ROW EXECUTE FUNCTION tg_notify_bid_submitted();
CREATE OR REPLACE TRIGGER t_customer_rating_agg AFTER INSERT ON public.customer_ratings FOR EACH ROW EXECUTE FUNCTION tg_customer_rating_aggregate();
CREATE OR REPLACE TRIGGER driver_locations_anomaly_check BEFORE INSERT OR UPDATE ON public.driver_locations FOR EACH ROW EXECUTE FUNCTION tg_check_location_anomaly();
CREATE OR REPLACE TRIGGER driver_locations_touch BEFORE UPDATE ON public.driver_locations FOR EACH ROW EXECUTE FUNCTION tg_touch_updated_at();
CREATE OR REPLACE TRIGGER t_driver_level BEFORE UPDATE OF jobs_completed ON public.driver_profiles FOR EACH ROW EXECUTE FUNCTION tg_driver_level();
CREATE OR REPLACE TRIGGER t_driver_updated BEFORE UPDATE ON public.driver_profiles FOR EACH ROW EXECUTE FUNCTION tg_touch_updated_at();
CREATE OR REPLACE TRIGGER trg_driver_profiles_guard_direct_write BEFORE UPDATE ON public.driver_profiles FOR EACH ROW EXECUTE FUNCTION driver_profiles_guard_direct_write();
CREATE OR REPLACE TRIGGER job_evidence_no_change BEFORE DELETE OR UPDATE ON public.job_evidence FOR EACH ROW EXECUTE FUNCTION job_evidence_immutable();
CREATE OR REPLACE TRIGGER jobs_block_restricted_insert BEFORE INSERT ON public.jobs FOR EACH ROW EXECUTE FUNCTION jobs_block_restricted();
CREATE OR REPLACE TRIGGER jobs_guard_direct_write_update BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION jobs_guard_direct_write();
CREATE OR REPLACE TRIGGER jobs_initial_dispatch AFTER INSERT ON public.jobs FOR EACH ROW EXECUTE FUNCTION trigger_initial_dispatch();
CREATE OR REPLACE TRIGGER jobs_photo_timestamps BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION jobs_stamp_photo_times();
CREATE OR REPLACE TRIGGER jobs_validate_budget BEFORE INSERT OR UPDATE OF budget, material ON public.jobs FOR EACH ROW EXECUTE FUNCTION tg_validate_job_budget();
CREATE OR REPLACE TRIGGER t_jobs_updated BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION tg_touch_updated_at();
CREATE OR REPLACE TRIGGER trg_generate_delivery_pin BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION tg_generate_delivery_pin();
CREATE OR REPLACE TRIGGER trg_notify_job_status AFTER UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION tg_notify_job_status();
CREATE OR REPLACE TRIGGER trg_notify_new_job_posted AFTER INSERT ON public.jobs FOR EACH ROW EXECUTE FUNCTION tg_notify_new_job_posted();
CREATE OR REPLACE TRIGGER trg_notify_preferred_driver AFTER INSERT ON public.jobs FOR EACH ROW EXECUTE FUNCTION tg_notify_preferred_driver();
CREATE OR REPLACE TRIGGER trg_flag_contact_sharing AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION tg_flag_contact_sharing();
CREATE OR REPLACE TRIGGER trg_notify_new_message AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION tg_notify_new_message();
CREATE OR REPLACE TRIGGER trg_send_push_on_notification AFTER INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION tg_send_push_on_notification();
CREATE OR REPLACE TRIGGER t_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION tg_touch_updated_at();
CREATE OR REPLACE TRIGGER t_rating_agg AFTER INSERT ON public.ratings FOR EACH ROW EXECUTE FUNCTION tg_rating_aggregate();
CREATE OR REPLACE TRIGGER trg_notify_new_report AFTER INSERT ON public.reports FOR EACH ROW EXECUTE FUNCTION tg_notify_new_report();
CREATE OR REPLACE TRIGGER set_thread_summaries_updated_at BEFORE UPDATE ON public.thread_summaries FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- -----------------------------------------------------------------------------
-- Views
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.driver_public_profiles AS
 SELECT dp.user_id,
    COALESCE(agg.avg_rating, (0)::numeric) AS rating_avg,
    (COALESCE(agg.cnt, (0)::bigint))::integer AS rating_count,
    dp.level,
    dp.jobs_completed,
    dp.verification_status
   FROM (driver_profiles dp
     LEFT JOIN ( SELECT ratings.driver_id,
            avg((((((ratings.quality + ratings.communication) + ratings.reliability) + ratings.delivery_time))::numeric / 4.0)) AS avg_rating,
            count(*) AS cnt
           FROM ratings
          GROUP BY ratings.driver_id) agg ON ((agg.driver_id = dp.user_id)));

CREATE OR REPLACE VIEW public.market_rate_history AS
 SELECT j.material,
    band.distance_band,
    count(*) AS trip_count,
    round(avg(j.budget), 2) AS avg_accepted_price,
    round(avg((j.budget / NULLIF(j.quantity_m3, (0)::numeric))), 2) AS avg_price_per_m3,
    min(j.budget) AS min_accepted_price,
    max(j.budget) AS max_accepted_price
   FROM ((jobs j
     CROSS JOIN LATERAL ( SELECT (((2 * 6371))::double precision * asin(sqrt((power(sin((radians((j.delivery_lat - j.pickup_lat)) / (2)::double precision)), (2)::double precision) + ((cos(radians(j.pickup_lat)) * cos(radians(j.delivery_lat))) * power(sin((radians((j.delivery_lng - j.pickup_lng)) / (2)::double precision)), (2)::double precision)))))) AS km) d)
     CROSS JOIN LATERAL ( SELECT
                CASE
                    WHEN (d.km <= (10)::double precision) THEN '0-10km'::text
                    WHEN (d.km <= (20)::double precision) THEN '10-20km'::text
                    WHEN (d.km <= (30)::double precision) THEN '20-30km'::text
                    WHEN (d.km <= (50)::double precision) THEN '30-50km'::text
                    ELSE '50km+'::text
                END AS distance_band) band)
  WHERE ((j.status = 'completed'::job_status) AND (j.pickup_lat IS NOT NULL) AND (j.pickup_lng IS NOT NULL) AND (j.delivery_lat IS NOT NULL) AND (j.delivery_lng IS NOT NULL))
  GROUP BY j.material, band.distance_band;


-- -----------------------------------------------------------------------------
-- Table grants (anon / authenticated / service_role)
-- -----------------------------------------------------------------------------
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.admin_audit_log TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.admin_audit_log TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.bids TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.bids TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.bids TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.cancellation_events TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.cancellation_events TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.cancellation_events TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.chat_flags TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.chat_flags TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.chat_flags TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.conversation_members TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.conversation_members TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.conversation_members TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.conversation_messages TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.conversation_messages TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.conversation_messages TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.conversations TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.conversations TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.conversations TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.customer_ratings TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.customer_ratings TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.customer_ratings TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.disputes TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.disputes TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.disputes TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.driver_locations TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.driver_locations TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.driver_locations TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.driver_profiles TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.driver_profiles TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.driver_profiles TO service_role;
GRANT SELECT ON public.driver_public_profiles TO anon;
GRANT SELECT ON public.driver_public_profiles TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.driver_public_profiles TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.evidence_access_log TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.evidence_access_log TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.evidence_access_log TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.job_dispatch_offers TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.job_dispatch_offers TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.job_dispatch_offers TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.job_evidence TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.job_evidence TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.jobs TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.jobs TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.jobs TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.location_anomalies TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.location_anomalies TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.location_anomalies TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.market_rate_history TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.market_rate_history TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.market_rate_history TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.material_price_buckets TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.material_price_buckets TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.material_price_buckets TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.material_prices TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.material_prices TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.material_prices TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.messages TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.messages TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.messages TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.notifications TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.notifications TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.notifications TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.payments TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.payments TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.payments TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.pin_attempts TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.pin_attempts TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.pin_attempts TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.profiles TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.profiles TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.profiles TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.push_subscriptions TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.push_subscriptions TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.push_subscriptions TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.ratings TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.ratings TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.ratings TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.reports TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.reports TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.reports TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.system_settings TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.system_settings TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.system_settings TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.thread_summaries TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.thread_summaries TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.thread_summaries TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.trucks TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.trucks TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.trucks TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.user_hints_seen TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.user_hints_seen TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.user_hints_seen TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.user_roles TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.user_roles TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.user_roles TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.wallet_audit_log TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.wallet_audit_log TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.wallet_audit_log TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.wallet_topup_requests TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.wallet_topup_requests TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.wallet_topup_requests TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.wallet_transactions TO anon;
GRANT REFERENCES, SELECT, TRIGGER, TRUNCATE ON public.wallet_transactions TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.wallet_transactions TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.wallet_withdrawal_requests TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.wallet_withdrawal_requests TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.wallet_withdrawal_requests TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.wallets TO anon;
GRANT REFERENCES, SELECT, TRIGGER, TRUNCATE ON public.wallets TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.wallets TO service_role;


-- -----------------------------------------------------------------------------
-- Row level security — enable
-- -----------------------------------------------------------------------------
ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bids ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cancellation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence_access_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_dispatch_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.location_anomalies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_price_buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pin_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.thread_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trucks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_hints_seen ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_topup_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_withdrawal_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;


-- -----------------------------------------------------------------------------
-- Row level security — policies
-- -----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE POLICY admin_audit_log_read ON public.admin_audit_log FOR SELECT TO authenticated
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Bids visibility" ON public.bids FOR SELECT TO authenticated
  USING (((driver_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM jobs j
  WHERE ((j.id = bids.job_id) AND (j.customer_id = auth.uid())))) OR has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Customers update bids on own jobs" ON public.bids FOR UPDATE TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM jobs j
  WHERE ((j.id = bids.job_id) AND (j.customer_id = auth.uid())))));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Drivers create bids" ON public.bids FOR INSERT TO authenticated
  WITH CHECK (((driver_id = auth.uid()) AND has_role(auth.uid(), 'driver'::app_role) AND (EXISTS ( SELECT 1
   FROM wallets w
  WHERE ((w.user_id = auth.uid()) AND (w.limited = false)))) AND (EXISTS ( SELECT 1
   FROM driver_profiles dp
  WHERE ((dp.user_id = auth.uid()) AND (dp.verification_status = 'verified'::verification_status) AND ((dp.reverify_due_at IS NULL) OR (dp.reverify_due_at > now())))))));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Drivers update own bids" ON public.bids FOR UPDATE TO authenticated
  USING ((driver_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY cancellation_events_own ON public.cancellation_events FOR SELECT TO authenticated
  USING (((user_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "chat_flags: admin read" ON public.chat_flags FOR SELECT TO public
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "members can select memberships" ON public.conversation_members FOR SELECT TO authenticated
  USING ((conversation_id IN ( SELECT conversation_members_1.conversation_id
   FROM conversation_members conversation_members_1
  WHERE (conversation_members_1.user_id = auth.uid()))));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "user can join their own conversation" ON public.conversation_members FOR INSERT TO authenticated
  WITH CHECK ((user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "user can leave their conversation" ON public.conversation_members FOR DELETE TO authenticated
  USING ((user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "members can delete own messages" ON public.conversation_messages FOR DELETE TO authenticated
  USING ((sender_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "members can insert messages" ON public.conversation_messages FOR INSERT TO authenticated
  WITH CHECK (((sender_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM conversation_members cm
  WHERE ((cm.conversation_id = conversation_messages.conversation_id) AND (cm.user_id = auth.uid()))))));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "members can select messages" ON public.conversation_messages FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM conversation_members cm
  WHERE ((cm.conversation_id = conversation_messages.conversation_id) AND (cm.user_id = auth.uid())))));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "members can update messages" ON public.conversation_messages FOR UPDATE TO authenticated
  USING (((sender_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM conversation_members cm
  WHERE ((cm.conversation_id = conversation_messages.conversation_id) AND (cm.user_id = auth.uid()))))))
  WITH CHECK ((sender_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "members can insert conversations" ON public.conversations FOR INSERT TO authenticated
  WITH CHECK ((created_by = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "members can select conversations" ON public.conversations FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM conversation_members cm
  WHERE ((cm.conversation_id = conversations.id) AND (cm.user_id = auth.uid())))));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Authenticated can read customer ratings" ON public.customer_ratings FOR SELECT TO authenticated
  USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Driver can rate the customer of their completed job" ON public.customer_ratings FOR INSERT TO authenticated
  WITH CHECK (((driver_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM jobs j
  WHERE ((j.id = customer_ratings.job_id) AND (j.driver_id = auth.uid()) AND (j.customer_id = customer_ratings.customer_id) AND (j.status = 'completed'::job_status))))));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Admins resolve disputes" ON public.disputes FOR UPDATE TO authenticated
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Disputes visibility" ON public.disputes FOR SELECT TO authenticated
  USING (((raised_by = auth.uid()) OR (against = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users raise disputes" ON public.disputes FOR INSERT TO authenticated
  WITH CHECK ((raised_by = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Customer reads location for own job" ON public.driver_locations FOR SELECT TO public
  USING (((EXISTS ( SELECT 1
   FROM jobs j
  WHERE ((j.id = driver_locations.job_id) AND (j.customer_id = auth.uid())))) OR has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Driver writes own job location" ON public.driver_locations FOR ALL TO public
  USING ((driver_id = auth.uid()))
  WITH CHECK (((driver_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM jobs j
  WHERE ((j.id = driver_locations.job_id) AND (j.driver_id = auth.uid()))))));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Admins read driver profiles" ON public.driver_profiles FOR SELECT TO authenticated
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Admins update driver profiles" ON public.driver_profiles FOR UPDATE TO authenticated
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Drivers manage own profile" ON public.driver_profiles FOR ALL TO authenticated
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY evidence_access_admin ON public.evidence_access_log FOR SELECT TO authenticated
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Customer/admin view job offers" ON public.job_dispatch_offers FOR SELECT TO authenticated
  USING (((EXISTS ( SELECT 1
   FROM jobs j
  WHERE ((j.id = job_dispatch_offers.job_id) AND (j.customer_id = auth.uid())))) OR has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Drivers view own offers" ON public.job_dispatch_offers FOR SELECT TO authenticated
  USING ((driver_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY job_evidence_read ON public.job_evidence FOR SELECT TO authenticated
  USING (((EXISTS ( SELECT 1
   FROM jobs j
  WHERE ((j.id = job_evidence.job_id) AND ((j.customer_id = auth.uid()) OR (j.driver_id = auth.uid()))))) OR has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Admins update jobs" ON public.jobs FOR UPDATE TO authenticated
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Customers create jobs" ON public.jobs FOR INSERT TO authenticated
  WITH CHECK (((customer_id = auth.uid()) AND has_role(auth.uid(), 'customer'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Customers update own jobs" ON public.jobs FOR UPDATE TO authenticated
  USING ((customer_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Drivers update assigned jobs" ON public.jobs FOR UPDATE TO authenticated
  USING ((driver_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Jobs visibility" ON public.jobs FOR SELECT TO authenticated
  USING (((customer_id = auth.uid()) OR (driver_id = auth.uid()) OR ((status = 'open'::job_status) AND has_role(auth.uid(), 'driver'::app_role)) OR has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Location anomalies visible to job parties" ON public.location_anomalies FOR SELECT TO authenticated
  USING (((EXISTS ( SELECT 1
   FROM jobs j
  WHERE ((j.id = location_anomalies.job_id) AND ((j.customer_id = auth.uid()) OR (j.driver_id = auth.uid()))))) OR has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Anyone can view material price buckets" ON public.material_price_buckets FOR SELECT TO public
  USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Prices are readable by all" ON public.material_prices FOR SELECT TO public
  USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Super admins manage prices" ON public.material_prices FOR ALL TO public
  USING (has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'super_admin'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Messages send" ON public.messages FOR INSERT TO authenticated
  WITH CHECK (((sender_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM jobs j
  WHERE ((j.id = messages.job_id) AND ((j.customer_id = auth.uid()) OR (j.driver_id = auth.uid())))))));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Messages visibility" ON public.messages FOR SELECT TO authenticated
  USING (((EXISTS ( SELECT 1
   FROM jobs j
  WHERE ((j.id = messages.job_id) AND ((j.customer_id = auth.uid()) OR (j.driver_id = auth.uid()))))) OR has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users delete own notifications" ON public.notifications FOR DELETE TO authenticated
  USING ((auth.uid() = user_id));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users read own notifications" ON public.notifications FOR SELECT TO authenticated
  USING ((auth.uid() = user_id));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users update own notifications" ON public.notifications FOR UPDATE TO authenticated
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY payments_admin_select ON public.payments FOR SELECT TO authenticated
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY payments_owner_select ON public.payments FOR SELECT TO authenticated
  USING ((user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY pin_read_own ON public.pin_attempts FOR SELECT TO authenticated
  USING ((user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Admins read all profiles" ON public.profiles FOR SELECT TO authenticated
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Customers view bidders on own jobs" ON public.profiles FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM (bids b
     JOIN jobs j ON ((j.id = b.job_id)))
  WHERE ((b.driver_id = profiles.id) AND (j.customer_id = auth.uid())))));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users can insert their own profile" ON public.profiles FOR INSERT TO public
  WITH CHECK ((auth.uid() = id));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users can update their own profile" ON public.profiles FOR UPDATE TO public
  USING ((auth.uid() = id));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT TO public
  USING ((auth.uid() = id));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users can view profiles of active job partners" ON public.profiles FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM jobs
  WHERE ((jobs.status = ANY (ARRAY['accepted'::job_status, 'in_progress'::job_status])) AND (((jobs.customer_id = auth.uid()) AND (jobs.driver_id = profiles.id)) OR ((jobs.driver_id = auth.uid()) AND (jobs.customer_id = profiles.id)))))));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users can view their own profile" ON public.profiles FOR SELECT TO public
  USING ((auth.uid() = id));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users insert own profile" ON public.profiles FOR INSERT TO authenticated
  WITH CHECK ((auth.uid() = id));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE TO authenticated
  USING ((auth.uid() = id))
  WITH CHECK ((auth.uid() = id));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "push_subscriptions: own delete" ON public.push_subscriptions FOR DELETE TO public
  USING ((auth.uid() = user_id));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "push_subscriptions: own insert" ON public.push_subscriptions FOR INSERT TO public
  WITH CHECK ((auth.uid() = user_id));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "push_subscriptions: own read" ON public.push_subscriptions FOR SELECT TO public
  USING ((auth.uid() = user_id));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "push_subscriptions: own update" ON public.push_subscriptions FOR UPDATE TO public
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Customers rate own completed jobs" ON public.ratings FOR INSERT TO authenticated
  WITH CHECK (((customer_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM jobs j
  WHERE ((j.id = ratings.job_id) AND (j.customer_id = auth.uid()) AND (j.status = 'completed'::job_status))))));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Ratings readable by authenticated" ON public.ratings FOR SELECT TO authenticated
  USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY reports_admin_select_all ON public.reports FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM user_roles
  WHERE ((user_roles.user_id = auth.uid()) AND (user_roles.role = ANY (ARRAY['admin'::app_role, 'super_admin'::app_role]))))));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY reports_admin_update ON public.reports FOR UPDATE TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM user_roles
  WHERE ((user_roles.user_id = auth.uid()) AND (user_roles.role = ANY (ARRAY['admin'::app_role, 'super_admin'::app_role]))))));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY reports_insert_own ON public.reports FOR INSERT TO authenticated
  WITH CHECK ((user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY reports_select_own ON public.reports FOR SELECT TO authenticated
  USING ((user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Public settings readable by authenticated" ON public.system_settings FOR SELECT TO authenticated
  USING ((key = ANY (ARRAY['diesel_price_per_liter'::text, 'commission_rate'::text])));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Super admin manages settings" ON public.system_settings FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'super_admin'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "members can select summaries" ON public.thread_summaries FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM conversation_members cm
  WHERE ((cm.conversation_id = thread_summaries.conversation_id) AND (cm.user_id = auth.uid())))));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "members can update summaries" ON public.thread_summaries FOR UPDATE TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM conversation_members cm
  WHERE ((cm.conversation_id = thread_summaries.conversation_id) AND (cm.user_id = auth.uid())))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM conversation_members cm
  WHERE ((cm.conversation_id = thread_summaries.conversation_id) AND (cm.user_id = auth.uid())))));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "members can upsert summaries" ON public.thread_summaries FOR INSERT TO authenticated
  WITH CHECK ((EXISTS ( SELECT 1
   FROM conversation_members cm
  WHERE ((cm.conversation_id = thread_summaries.conversation_id) AND (cm.user_id = auth.uid())))));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Drivers manage own trucks" ON public.trucks FOR ALL TO authenticated
  USING ((driver_id = auth.uid()))
  WITH CHECK ((driver_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Trucks readable by authenticated" ON public.trucks FOR SELECT TO authenticated
  USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "user_hints_seen: own insert" ON public.user_hints_seen FOR INSERT TO public
  WITH CHECK ((auth.uid() = user_id));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "user_hints_seen: own read" ON public.user_hints_seen FOR SELECT TO public
  USING ((auth.uid() = user_id));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Admins read roles" ON public.user_roles FOR SELECT TO authenticated
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Super admins delete roles" ON public.user_roles FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'super_admin'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Super admins insert roles" ON public.user_roles FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'super_admin'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Super admins update roles" ON public.user_roles FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'super_admin'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users read own roles" ON public.user_roles FOR SELECT TO authenticated
  USING ((user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY audit_read_own_or_admin ON public.wallet_audit_log FOR SELECT TO authenticated
  USING (((user_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY topup_owner_cancel ON public.wallet_topup_requests FOR UPDATE TO authenticated
  USING (((user_id = auth.uid()) AND (status = 'pending'::text)))
  WITH CHECK (((user_id = auth.uid()) AND (status = ANY (ARRAY['pending'::text, 'cancelled'::text]))));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY topup_owner_insert ON public.wallet_topup_requests FOR INSERT TO authenticated
  WITH CHECK (((user_id = auth.uid()) AND (status = 'pending'::text)));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY topup_owner_or_super_admin_select ON public.wallet_topup_requests FOR SELECT TO public
  USING (((user_id = auth.uid()) OR has_role(auth.uid(), 'super_admin'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY topup_super_admin_update ON public.wallet_topup_requests FOR UPDATE TO public
  USING (has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'super_admin'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Admins read today tx" ON public.wallet_transactions FOR SELECT TO authenticated
  USING ((has_role(auth.uid(), 'admin'::app_role) AND (created_at >= date_trunc('day'::text, now()))));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Super admins read all tx" ON public.wallet_transactions FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'super_admin'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users read own tx" ON public.wallet_transactions FOR SELECT TO authenticated
  USING ((user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY wd_admin_update ON public.wallet_withdrawal_requests FOR UPDATE TO authenticated
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)))
  WITH CHECK ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY wd_owner_cancel ON public.wallet_withdrawal_requests FOR UPDATE TO authenticated
  USING (((user_id = auth.uid()) AND (status = 'pending'::text)))
  WITH CHECK (((user_id = auth.uid()) AND (status = ANY (ARRAY['pending'::text, 'cancelled'::text]))));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY wd_owner_insert ON public.wallet_withdrawal_requests FOR INSERT TO authenticated
  WITH CHECK (((user_id = auth.uid()) AND (status = 'pending'::text)));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY wd_owner_select ON public.wallet_withdrawal_requests FOR SELECT TO authenticated
  USING (((user_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Admins read wallets" ON public.wallets FOR SELECT TO authenticated
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users read own wallet" ON public.wallets FOR SELECT TO authenticated
  USING ((user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

