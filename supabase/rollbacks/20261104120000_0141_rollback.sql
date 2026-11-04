-- Undo 0141. WARNING: do NOT run this on production. There the trigger existed before 0141 and 0141 did nothing, so
-- dropping it would stop every new sign-up from getting a profile, role and wallet.
-- Only for a database where 0141 itself created the trigger (a rebuilt or test database).
drop trigger if exists on_auth_user_created on auth.users;
