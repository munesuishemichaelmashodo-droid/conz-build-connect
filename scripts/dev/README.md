# Local screen testing with sample data

Two local processes let you look at signed-in screens in a browser without touching
the hosted Supabase project:

| Process | Port | What it is |
| --- | --- | --- |
| `scripts/dev/mock-supabase.mjs` | 54399 | In-memory stand-in for Supabase auth, REST, RPC and storage, with sample users and jobs. Forgets everything on exit. |
| `vite dev` (`npm run dev`) | 5173 | The app, pointed at the stand-in instead of the real project. |

The stand-in is **not** Supabase: no RLS, triggers, realtime, pricing or money logic.
Use it to check screens and states, never as evidence that the backend is correct.

## 1. Check nothing is already running

Starting a second copy fails on the port, or leaves two servers fighting.

```sh
# 000 means nothing is listening on that port
curl -s -o /dev/null -w "54399: %{http_code}\n" http://localhost:54399/rest/v1/jobs
curl -s -o /dev/null -w "5173: %{http_code}\n" http://127.0.0.1:5173/
ps -eo pid,args | grep -E 'mock-supabase|vite dev' | grep -v grep || echo "nothing running"
```

If both answer, you can reuse them (see step 3) instead of restarting.

## 2. Start

Run each in its own terminal (or as a background job), from the repo root:

```sh
node scripts/dev/mock-supabase.mjs
```

```sh
VITE_SUPABASE_URL=http://localhost:54399 \
VITE_SUPABASE_PUBLISHABLE_KEY=sample-publishable-key \
VITE_SUPABASE_PROJECT_ID=local-mock \
SUPABASE_URL=http://localhost:54399 \
SUPABASE_PUBLISHABLE_KEY=sample-publishable-key \
SUPABASE_SERVICE_ROLE_KEY=sample-service-key \
npm run dev -- --port 5173 --host 127.0.0.1
```

These keys are placeholders the stand-in accepts. Never put real project keys here.
`MOCK_SMS=off node scripts/dev/mock-supabase.mjs` makes phone verification report
"not configured".

## 3. Check they are healthy

```sh
curl -s -o /dev/null -w "stand-in %{http_code}\n" http://localhost:54399/rest/v1/jobs
curl -s -o /dev/null -w "app %{http_code}\n" http://127.0.0.1:5173/
```

Both should print 200. The first app load after a dependency change can take a few
seconds while Vite rebuilds.

## 4. Sign in

Open http://127.0.0.1:5173/auth. Every password is `sample-pass-1`; the SMS code is
always `123456`.

- `customer@sample.test`: jobs a001–a005. a005 is an open request with four offers
  (one expired), for the offers screen.
- `driver@sample.test`, `applicant@sample.test`: driver home and driver sign-up.
- Admin and the other sample drivers are listed at the top of `mock-supabase.mjs`.

Offer expiry times are set when the stand-in starts, so restart it if the offers have
all expired.

## 5. Put a job in a particular state

Edit rows on the running stand-in only (nothing is saved to the seed file). Example:
customer job a002 on the road, loaded, no live location:

```sh
curl -s -X PATCH "http://localhost:54399/rest/v1/jobs?id=eq.00000000-0000-4000-8000-00000000a002" \
  -H "apikey: sample-publishable-key" -H "content-type: application/json" \
  -d '{"status":"in_progress","pickup_photo_url":"00000000-0000-4000-8000-00000000a002/pickup-1.jpg","pickup_photo_taken_at":"2026-10-23T03:48:00Z","pricing_breakdown":{"distance_km":18}}'
```

Add a live driver location (POST to `/rest/v1/driver_locations` with `job_id`,
`driver_id`, `lat`, `lng`, `updated_at`) to see the route and trip progress. Restarting
the stand-in resets everything.

## 6. Stop

Stop by process id. `pkill -f` can match and kill your own shell.

```sh
ps -eo pid,args | awk '$2=="node" && $3=="scripts/dev/mock-supabase.mjs" {print $1}' | xargs -r kill
ps -eo pid,args | grep 'vite dev --port 5173' | grep -v grep | awk '{print $1}' | xargs -r kill
```

## Known local-only noise

- The map shows "API key required" tiles: no map key is set locally.
- Console errors for `ws://localhost:54399/realtime/...`: the stand-in has no realtime,
  so live updates need a page reload.
- A `400` on `auth/v1/token?grant_type=refresh_token` after a restart: the browser still
  holds a session from the previous run. Sign in again.

## Playwright in the cloud container

The Playwright MCP server looks for Chrome at `/opt/google/chrome/chrome`. If it is
missing, point that path at the bundled Chromium with `--no-sandbox` (needed when
running as root), and save screenshots under `/home/user`.
