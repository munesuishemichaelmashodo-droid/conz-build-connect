-- Undo 0158 (DROP: SQL editor). Safe: nothing uses the function or column yet.
drop function if exists public.compute_transport_offer(numeric, numeric);
alter table public.jobs drop column if exists pricing_basis;
delete from public.system_settings where key = 'transport_pricing_enabled';
