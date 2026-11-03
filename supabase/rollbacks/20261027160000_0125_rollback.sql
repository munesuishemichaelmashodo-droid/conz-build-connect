-- Undo 0125: restore the table grants as they were on 27/10/2026 (RLS policies were never changed). No DROP.
grant insert, update, delete on table public.system_settings       to anon, authenticated;
grant insert, update, delete on table public.material_prices        to anon, authenticated;
grant insert, update, delete on table public.material_price_buckets to anon, authenticated;
grant insert, update, delete on table public.user_roles             to anon, authenticated;
grant insert, update, delete on table public.small_load_settings    to anon, authenticated;
