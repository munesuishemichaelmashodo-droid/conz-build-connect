-- -----------------------------------------------------------------------------
-- 0119: cap an offer's message at 500 characters.
--
-- PREPARED, NOT APPLIED. Needs the owner's approval before production. No DROP
-- (safe for the Supabase MCP tool). Undo: supabase/rollbacks/20261026140000_0119_rollback.sql.
--
-- Why: bids.message is free text with no limit in the database. The app caps it
-- (300-character note + an 80-character proposed source, about 400 in total), but
-- a driver calling the API directly could store a very long message that every
-- customer viewing the job then loads. Production on 26/10/2026: 50 offers,
-- longest message 30 characters, so no existing row is affected.
-- Not payment-related. Independent of 0113-0118.
-- -----------------------------------------------------------------------------

alter table public.bids
  add constraint bids_message_length
  check (message is null or char_length(message) <= 500) not valid;

alter table public.bids validate constraint bids_message_length;
