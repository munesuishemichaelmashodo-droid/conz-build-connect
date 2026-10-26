-- Undo 0119. Contains DROP: run in the Supabase SQL editor (the MCP tool hangs on DROP).
alter table public.bids drop constraint if exists bids_message_length;
