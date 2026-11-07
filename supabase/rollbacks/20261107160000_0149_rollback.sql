-- Undo 0149 (post-delivery feedback). Contains DROP: run in the SQL editor. Collected answers are lost.
drop function if exists public.submit_delivery_feedback(uuid, text, text);
drop function if exists public.dismiss_delivery_feedback(uuid);
drop table if exists public.delivery_feedback;
