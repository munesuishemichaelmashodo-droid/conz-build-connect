# Admin accounts: Google sign-in protection (owner guide)

How it works today (migration 0111, live since 23/10/2026):

- Money, role and price actions (approving payouts and top-ups, refunds, changing roles, commission; once
  their changes are live, also the payment switch (PR #38) and material prices (0124)) need a **recent Google sign-in**: within the last 12 hours,
  on an admin account that has Google linked. A password sign-in alone is not enough for these actions.
- Only the two listed owners can ever be super admin (`super_admin_owners`; adding one is a database-only step).
- An admin account cannot be linked to a Google account with a different email.
- Owners get an alert when an admin signs in (since 0122: not about their own sign-in, and at most once per
  30 minutes per admin) and for every admin action in the audit log. Customers and drivers never get these.

## Set it up (each owner, once)

1. **Turn on Google 2-Step Verification** for the Google account you use for Con Z:
   myaccount.google.com → Security → 2-Step Verification → turn on. Add a passkey or the Google Authenticator
   app as a second step, and save the backup codes somewhere safe (not on the same phone).
2. **Link Google to your Con Z admin account:** sign out of Con Z, then use **Continue with Google** with the
   *same email* as your admin account. Your account now has a Google identity.
3. **Before a money or role action**, if Con Z says a fresh sign-in is needed, tap the button in the message
   and sign in with Google again. That is valid for 12 hours.

## If you get an alert you don't recognise

1. Change that admin's Con Z password at once (Profile → Set / change login password) and tell the other owner.
2. In Google: myaccount.google.com → Security → Your devices → sign out unknown devices; change the Google password.
3. Check Admin → Audit for anything done in that window.

---

## Optional: authenticator app (migration 0166, built 10/11/2026, NOT live until applied)

**What it is.** An extra lock for an admin account. Without it, money and role actions need a Google sign-in from the last 12 hours (as today). With it, those actions need a 6-digit code from an app on your phone, and a Google sign-in alone is refused for that account. A code stays good for 15 minutes; entering a new one does not sign you out. Nothing changes for an admin who has not set it up.

**Set it up (2 minutes).**
1. Install Google Authenticator (or Authy, 1Password) on your phone.
2. In Con Z open Admin > Settings > "Authenticator app" > **Set up authenticator app**.
3. Scan the square code with the app, type the 6-digit code it shows, press **Verify & continue**.
4. Test: open Admin > Revenue and change nothing but press save on a money setting. You should be asked to "Verify it's you" and taken to the code screen.

**If a phone is lost.** The OTHER owner opens Admin > Settings > "Authenticator app", finds the name, presses **Reset**, writes the reason (for example "lost phone") and confirms. The account goes back to the Google rule and can set up a new authenticator. An owner cannot reset their own. Every set-up, removal and reset is in Admin > Audit and both owners get a notification.

**Recommended order.** One owner sets it up and tests a money action and a reset by the other owner; only then the second owner sets theirs up. Do not set up both on the same day, so one of you can always reset the other.

**If both owners lose their phones at once.** A developer with access to the Supabase dashboard removes the factor under Authentication > Users. There is no hidden password or bypass account.

## Cloudflare Access: assessed, not recommended now

The site runs on Vercel, the admin screens are pages on the same address as the customer and driver app (`/admin/...`), and every admin action goes from the browser straight to Supabase, not through the website. A Cloudflare gate in front of `/admin` would therefore hide only the admin screens' empty shell; it would not protect the data or the actions (the database rules above do that), and putting Cloudflare in front of the whole site means moving the domain's DNS and risks the Android app, sign-in returns and the Paynow callback. Recommendation: do not add it now. If wanted later, the clean way is a separate admin address (for example `admin.conz.co.zw`) behind Cloudflare Access, as its own project with a rollback plan and the owner's approval for the DNS change.

## Authenticator app: quick link, 30-day check, "required" switch (11/11/2026, migration 0169)

- **Quick link on every admin page.** A strip at the top of each admin screen shows the authenticator state with one button
  to the code screen, which brings you back to the same page: "Set up authenticator" (none yet), "Verify now" (30 days passed),
  or a quiet "Authenticator verified, N days left".
- **Every 30 days.** The database records when each admin last entered a valid code (`admin_authenticator_checks`, written only
  from a verified session). Past 30 days the admin screens send that admin to the code screen first.
- **Crucial changes.** Money and role actions ask for a fresh code (valid 15 minutes) every time, whatever the 30-day state. This
  is enforced in the database (`require_aal2()`), not just the screen.
- **"Required" switch** (Settings > Authenticator app, super admin). Off by default, because neither owner had set the app up when
  this shipped. Set the app up on BOTH owner accounts first, then switch it on (needs your own app, a fresh code and a reason; it
  is audited). While on, a Google sign-in alone is never accepted for money or role changes, for any admin.
- Lost phone: the other owner resets it (Settings > Authenticator app > Reset), as before. Undo for 0169:
  `supabase/rollbacks/20261111120000_0169_rollback.sql` (contains DROP: run in the SQL editor).
