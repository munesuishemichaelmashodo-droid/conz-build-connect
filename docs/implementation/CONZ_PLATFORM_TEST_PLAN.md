# ConZ platform test plan: Android phone, iOS, push (09/11/2026)

Purpose: the three things that cannot be proven from a cloud session (real Android phone, iOS, push delivery) need a person with a device. This page is the exact script, so one 20-minute session
produces evidence. Results go back in the table at the end. Nothing here changes production.

## 1. Where each platform stands today (evidence)

| Platform | State | Evidence (09/11/2026) |
| --- | --- | --- |
| Web (www.conz.co.zw) | Deployed, CI green | Home and Terms 200; unit (862), database (1830) and browser checks on the local stand-in |
| Android APK | **Build-only.** The shell loads the live site; never tested on a phone by this project's automation | CI job `build-android-apk` green on every PR; artifact `conz-debug-apk` (kept 14 days) |
| Android push (FCM) | **Never exercised.** Code and `google-services.json` exist; **no phone has ever registered a token** | Production `device_tokens`: 0 rows (0 android, 0 ios) |
| Web push | Registration works somewhere; **delivery not verified** | Production `push_subscriptions`: 6 rows, newest 26/10/2026 |
| iOS | **Not ready.** No `ios/` project, `@capacitor/ios` not installed, no APNs setup | `ls ios` fails; `package.json` has only `@capacitor/android` |

Android manifest requests: internet, camera (optional hardware), fine and coarse location, post-notifications. The OAuth return uses the custom scheme `com.conz.app://oauth-callback`.

## 2. Android phone test (about 20 minutes, any Android 10+ phone)

Get the app: GitHub, repository Actions, newest green "Verify build" or "Android debug APK build" run, artifact **conz-debug-apk**; unzip, copy `app-debug.apk` to the phone, allow install from the file manager.
(It is a debug build: it will show as "unsafe" to Play Protect. That is expected. It is not the store build.)

Use a **test customer** and a **test driver** (two phones, or sign out between). Do not use real customers' accounts.

| # | Step | Pass looks like | Why it matters |
| --- | --- | --- | --- |
| A1 | Open the app | Con Z home loads inside the app, not in Chrome | The shell loads www.conz.co.zw directly |
| A2 | Sign in with Google | Returns to the app signed in (no "session was not completed") | The custom-scheme OAuth return |
| A3 | Sign in with email and password (second account) | Signs in; sign-out works | Basic auth |
| A4 | Accept Terms; skip or finish the first-run walkthrough | Both work; skip is available | Onboarding spec |
| A5 | Tap **Enable notifications** (walkthrough or profile) | Android asks permission; after allowing, no error shown | Starts FCM registration |
| A6 | Customer posts a small test job; driver account sees the request notification | A notification arrives on the driver's phone (screen off, app closed) | End-to-end push delivery |
| A7 | Driver sends an offer; customer opens offers; accepts it | Offer card shows truck facts, no phone number before choosing; Agreement card appears | Marketplace rules on a real screen |
| A8 | Driver proposes a deposit in the Agreement card; customer view | Customer sees the deposit read-only and can only confirm or suggest other terms | 0162/0163 |
| A9 | Driver takes the pickup photo (camera permission) and shares location | Camera opens, photo uploads; customer sees the position update | Camera and location in the WebView |
| A10 | Turn on airplane mode on a job page | "No signal" banner; "Ready offline" card shows address and PIN | Offline card |
| A11 | Driver top-up: open Wallet, start a **$1** top-up (only if the owner wants the Paynow test) | Paynow page opens in the app and returns to Wallet | Paynow in the WebView (see payments handover) |
| A12 | Press the Android back button on every main screen | Goes back sensibly; never exits unexpectedly or loops | WebView navigation |

After A5, check that a token was stored: ask Claude to run the read-only count on `device_tokens` (expect 1 or more rows with platform `android`). If there is no row after allowing notifications,
push registration is broken and A6 cannot pass: report the exact screen and message.

## 3. Web push check (any phone or computer browser, 5 minutes)
Sign in at www.conz.co.zw, enable notifications when asked, then trigger one event for that account (for example a driver account receiving a new nearby request, or a customer receiving an offer).
Pass = a browser/OS notification appears with the app closed. Report browser and OS. (6 subscriptions exist but nothing proves delivery.)

## 4. iOS: what is needed (owner and a Mac; nothing here is done)
1. A Mac with Xcode, and an Apple Developer Program membership (paid, owner's account).
2. Decide the bundle id. The Android id is `com.conz.app`; changing identifiers or signing is an owner decision, so the spec says not to change them without approval.
3. In the repo: `npm i @capacitor/ios`, `npx cap add ios`, set usage strings (camera, location when in use), enable the Push Notifications capability and Background Modes if wanted.
4. Push: create an APNs key in the Apple developer account and upload it to the Firebase project that already serves Android; then the server's existing `device_tokens` path can carry iOS tokens (`native-push.ts` already branches on platform).
5. The site is loaded from www.conz.co.zw, so App Store review will want real native value (push, camera, location, offline card). Prepare account-deletion in-app (exists: Profile, Delete my account) and a privacy label.
6. Test on a real iPhone or a TestFlight build; a simulator cannot receive APNs pushes.
Until then ConZ reports iOS as **not ready** and says so in every status line.

## 5. Record results here
| Test | Device and OS | Date | Result (pass / fail and message) |
| --- | --- | --- | --- |
| A1-A4 | | | |
| A5-A6 (push) | | | |
| A7-A8 | | | |
| A9 | | | |
| A10 | | | |
| A11 (optional $1 Paynow) | | | |
| A12 | | | |
| Web push | | | |
| iOS | | | not started |

Send the filled table (or screenshots of any failure) and the next session turns each failure into a ticket with a failing test.
