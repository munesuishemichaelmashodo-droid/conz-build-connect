-- Undo 0164: back to a role-mutable search path (as created by 0148).
alter function public.cancellation_reason_known(text) reset search_path;
alter function public.cancellation_reason_allowed(text, text) reset search_path;
