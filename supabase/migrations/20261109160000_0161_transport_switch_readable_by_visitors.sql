-- 0161: the public pages (home, terms) describe what the commission is charged on, so they need to know whether
-- delivery-only pricing is on. transport_pricing_enabled() returns one boolean and nothing else, so signed-out
-- visitors may call it. Errors on the client are treated as "off". No DROP. Undo: revoke execute from anon.
grant execute on function public.transport_pricing_enabled() to anon;
