# Security fixes, 24/11/2026 (branch `fix/mvp-security`)

Nothing in this branch has been applied to production. Each step below needs the owner's go.

## 1. `driver_public_profiles` — verified drivers only (migration 0170)

| | |
| --- | --- |
| Problem | Any signed-in user could read every driver's id, rating, level, job count and `verification_status`, including pending and rejected drivers (SECURITY DEFINER view, so `driver_profiles` RLS does not apply) |
| Change | Same view, same columns and grants, plus `where verified or own row or admin` |
| App impact | None: the two readers (`jobs.$id.tsx` bidder fallback, `chat.$jobId.tsx` peer stats) only look up verified drivers |
| Test | pgTAP `1010_driver_public_profiles_verified_only` (8 checks) |
| Undo | `supabase/rollbacks/20261124100000_0170_rollback.sql` (exact live definition read 24/11) |

Apply (after the PR is merged and deployed):

1. Before: `select md5(pg_get_viewdef('public.driver_public_profiles'::regclass));` and save the value.
2. Run the body of `supabase/migrations/20261124100000_0170_driver_public_profiles_verified_only.sql` (no DROP; safe through `execute_sql`).
3. Record it: `insert into supabase_migrations.schema_migrations (version, name) values ('20261124100000', 'driver_public_profiles_verified_only');`
4. Check: as a customer the view returns only `verification_status = 'verified'` rows; the job page offer list and the chat header still show driver stats.

## 2. `send-sms` edge function — deploy the fail-closed version from git

| | |
| --- | --- |
| Problem | The **deployed** `send-sms` (v11, deployed 05/08) checks the Supabase hook signature **only if** `SEND_SMS_HOOK_SECRET` is set; without it, anyone can make ConZ send SMS through Africa's Talking |
| Already fixed in git | `supabase/functions/send-sms/index.ts` + `verify.ts` refuse when the secret is missing, verify the Standard Webhooks signature with a 5-minute window, and only send to allowed destinations; unit test `tests/unit/send-sms.verify.test.ts` (8 pass) |
| Risk of deploying | If `SEND_SMS_HOOK_SECRET` is **not** set, phone OTP stops working (it fails closed). Set the secret first |

Steps (owner, Supabase dashboard):

1. Auth → Hooks → Send SMS hook: confirm it is enabled and copy its secret (`v1,whsec_…`). If the hook is **not** enabled, phone OTP is not in use; deploy anyway (it then refuses everything, which is the safe state).
2. Edge Functions → Secrets: set `SEND_SMS_HOOK_SECRET` to that value (never paste it in chat or git).
3. Deploy: `supabase functions deploy send-sms --project-ref ovwrsocjmkpiygipmrdk --no-verify-jwt` from this repo.
4. Check: `curl -s -o /dev/null -w '%{http_code}' -X POST https://ovwrsocjmkpiygipmrdk.supabase.co/functions/v1/send-sms -d '{}'` must print `401` (or `500` "not configured" if step 2 was skipped). Then sign in with a phone number once to confirm OTP still arrives.
5. Undo: redeploy the previous version from the dashboard's function history.

## 3. Admin authenticator — owner action, no code

`require_aal2()` (live) already enforces a fresh authenticator code when `admin_authenticator_required = true`. On 24/11 **0 of 2** admins had an authenticator. Both owners: open `/mfa`, set up the app, verify a code; then a super admin switches "Require authenticator" on in Settings (0169). Until then a Google sign-in from the last 12 h approves money and role actions.

## 4. `send-push` — no change needed

Verified 24/11: the deployed v10 requires `x-conz-push-secret`, compared in constant time with `app_secrets.push_hook_secret`, and returns 401 before doing anything.
