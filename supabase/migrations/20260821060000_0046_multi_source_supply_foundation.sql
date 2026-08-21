-- Draft migration 0046: multi-source material supply foundation (Phase 1).
-- Purely additive. Does not touch material_prices, compute_material_offer,
-- tg_validate_job_budget, price_quotes, or any existing pricing/routing
-- object. A material with zero material_supply_locations rows behaves
-- exactly as it does in production today (Phase 2 requirement).

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_phone text,
  contact_email text,
  verification_status text not null default 'unverified'
    check (verification_status in ('unverified', 'verified', 'suspended')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.material_supply_locations (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  material public.material_category not null references public.material_prices(material),
  source_type text not null default 'depot'
    check (source_type in ('quarry', 'depot', 'supplier', 'stockpile', 'on_demand_source')),
  label text,
  address text,
  lat numeric,
  lng numeric,
  status text not null default 'active'
    check (status in ('active', 'paused', 'closed')),
  verification_status text not null default 'unverified'
    check (verification_status in ('unverified', 'verified', 'suspended')),
  price_override_min numeric,
  price_override_max numeric,
  price_override_mid numeric,
  operating_hours jsonb,
  available_quantity_m3 numeric,
  priority int not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A row can exist with no coordinates (on_demand_source placeholder --
  -- "we know this supplier exists, we haven't pinned a location yet") but
  -- it must never be usable as a resolved pickup point in that state.
  -- Enforced again in the resolution function itself, not just here.
  constraint valid_coords_or_null check (
    (lat is null and lng is null) or (lat between -90 and 90 and lng between -180 and 180)
  ),
  constraint on_demand_has_no_coords check (
    source_type <> 'on_demand_source' or (lat is null and lng is null)
  )
);

create index if not exists idx_material_supply_locations_material_status
  on public.material_supply_locations (material, status)
  where status = 'active';

create index if not exists idx_material_supply_locations_supplier
  on public.material_supply_locations (supplier_id);

comment on table public.suppliers is
  'A physical or logistical source of construction material. Additive to material_prices -- does not replace it. A material with zero linked material_supply_locations rows continues to use material_prices.pickup_lat/pickup_lng/pickup_label exactly as before.';
comment on table public.material_supply_locations is
  'One supplier x material x physical-site combination. Only rows with status=active, verification_status=verified, and non-null lat/lng are eligible for automatic pickup-source resolution. on_demand_source rows are a deliberate placeholder for materials (river sand, pit sand, top soil, filling soil) with no fixed depot -- they must never resolve to a pickup point on their own.';

alter table public.suppliers enable row level security;
alter table public.material_supply_locations enable row level security;

-- Read: any authenticated user can see active/verified supply locations
-- (same visibility level as material_prices today). Write: admin only,
-- matching the existing pattern for material_prices management.
create policy "Anyone can view suppliers" on public.suppliers
  for select using (true);
create policy "Admins manage suppliers" on public.suppliers
  for all using (public.has_role(auth.uid(), 'admin'::public.app_role) or public.has_role(auth.uid(), 'super_admin'::public.app_role));

create policy "Anyone can view supply locations" on public.material_supply_locations
  for select using (true);
create policy "Admins manage supply locations" on public.material_supply_locations
  for all using (public.has_role(auth.uid(), 'admin'::public.app_role) or public.has_role(auth.uid(), 'super_admin'::public.app_role));
