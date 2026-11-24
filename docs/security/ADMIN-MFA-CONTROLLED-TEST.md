# Admin authenticator: Android setup and controlled production test

For the two owners. TOTP (an authenticator app) is the only second factor. Passkeys are not used.
Nothing here switches "Authenticator required" on; only an owner does that, after both have passed section 2.

Each owner uses their OWN ConZ admin account, their OWN phone and their OWN authenticator entry. Never share
a QR code, setup key or code; never photograph or send the QR code.

## 1. Set up on Android (each owner, about 2 minutes)

1. On your phone, install **Google Authenticator** (or Microsoft Authenticator) from the Play Store.
2. On a computer, or in Chrome on the same phone, sign in to https://www.conz.co.zw with your own admin account.
3. Open **Admin → Settings → Authenticator app** and tap **Set up authenticator app**.
   (The page creates nothing until you tap this.)
4. In the authenticator app: tap **+** → **Scan a QR code** and scan the code on screen.
   - Setting up on the same phone? Tap the setup key under the QR code to copy it. Then in the app choose
     **+** → **Enter a setup key**, account name `Con Z Admin`, paste the key, type **Time based**.
5. The app now shows a 6-digit code for "Con Z Admin" that changes every 30 seconds. Type or paste it into ConZ.
   It is checked as soon as the sixth digit is in. You should see "Authenticator app linked".
6. Turn on your phone's screen lock. If you change phones, ask the other owner to reset your authenticator
   (Settings → Authenticator app → Reset) and set it up again.

Lost phone: the other owner resets it (their own fresh code and a reason are required; both owners are
notified). You can't reset your own.

## 2. Controlled test (both owners; record date, time and result for each row)

Use a harmless setting: the commission rate, saved unchanged at **7**, with the reason "MFA test". It needs
a fresh code and is audited. Do not change any money amount or switch.

| # | Who | Step | Expected |
|---|-----|------|----------|
| 1 | Owner A | Set up (section 1) | "Authenticator app linked"; Settings shows "On for your account" |
| 2 | Owner B | Set up | Same; Owner A's Settings lists both owners as "authenticator on" |
| 3 | A | Revenue → commission: save 7 with reason "MFA test", straight after setup | Saved; row in Audit |
| 4 | A | Enter a wrong code on the code screen | "That code didn't match…", boxes cleared, no sign-out |
| 5 | A | Enter a code you copied more than 2 minutes ago | Refused; enter the newest code and it works |
| 6 | A | Wait more than 15 minutes, save the commission again | "Verify it's you" → code screen → enter code → returns to the page; save works |
| 7 | B | Repeat 3–6 on B's own account | Same results |
| 8 | A | Paste a code (e.g. "123 456") | Accepted; spaces ignored |
| 9 | B | On a phone with no signal, open Admin | "Couldn't confirm your security check" + Try again; nothing opens |
| 10 | A, B | After both pass 1–8: Admin → Settings → Authenticator app → "Require authenticator for all admins", reason "Both owners verified" | Switched on; both owners notified; row in Audit |
| 11 | A | Sign in with Google only (new session) and save the commission | Refused until a code is entered |
| 12 | Any non-owner admin (if one exists later) | Try to change "Require authenticator" | Refused ("Only an owner can change this") |
| 13 | — | The 30-day check | Can't be fast-forwarded in production; proven by database test 1000 (13a–13h). The strip at the top of every admin page shows "N days until the next check" |

Role changes (granting or removing admin) use the same step-up. Test them only if an extra test account
exists; do not change the owners' roles.

If any row fails: stop, switch "Require authenticator" off again (row 10 in reverse, as an owner with a fresh
code), and report the row number and the exact message.

## 3. Database proof behind this (CI, every pull request)

- `990_admin_authenticator`: setup, reset by the other owner, audit and notifications.
- `1000_admin_authenticator_required`: the required switch and the 30-day record.
- `1080_admin_totp_only_stepup` (after 0174): TOTP only; passkey, phone and no-amr tokens refused; owner-only switch.
- `260_admin_stepup`, `410_admin_google_stepup_owner_lock`: money actions and the 15-minute window.
