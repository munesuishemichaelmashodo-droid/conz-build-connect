# Admin accounts: Google sign-in protection (owner guide)

How it works today (migration 0111, live since 23/10/2026):

- Money, role and price actions (approving payouts and top-ups, refunds, changing roles, commission, the payment
  switch, and, once 0124 is applied, material prices) need a **recent Google sign-in**: within the last 12 hours,
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
