# Con Z — Google Play readiness (Phase 20)

**Status 08/10/2026:** Android project hardened in git; **no release build produced, nothing uploaded.**
Release builds need the owner's signing key and a machine/CI with JDK 21 + Android SDK (this workstation has
neither; CI builds a *debug* APK on every push to `main`).

App: `com.conz.app` · minSdk 24 · target/compile SDK 36 · Capacitor 8 WebView shell loading
`https://www.conz.co.zw` (all business logic is server-side).

## 1. Done in this branch

| Item | Change |
|---|---|
| Backups (audit M15) | `allowBackup="false"`, `fullBackupContent="false"`, `data_extraction_rules.xml` excludes everything from cloud backup and device transfer (WebView storage holds the session refresh token) |
| Network | `network_security_config.xml`: HTTPS only, system CAs; `usesCleartextTraffic="false"` (Capacitor already `cleartext: false`) |
| FileProvider (L8) | `external-path "."` (all shared storage) → `external-files-path` (app-private) + cache |
| OAuth (H8) | native Google sign-in uses PKCE; the custom-scheme redirect carries only a one-time code (see `src/lib/capacitor-oauth-bridge.ts`) |
| Signing | `signingConfigs.release` reads `CONZ_KEYSTORE_PATH`, `CONZ_KEYSTORE_PASSWORD`, `CONZ_KEY_ALIAS`, `CONZ_KEY_PASSWORD` from the environment; `*.jks`, `*.keystore`, `keystore.properties` git-ignored |
| Versioning | `-PversionCode=N -PversionName=x.y.z` (defaults 1 / 1.0) |
| Minification | deliberately off (WebView shell; R8 unverifiable without a device build). Not a Play requirement. |

## 2. Owner steps to produce a signed AAB

```bash
# 1. Create the upload key ONCE and back it up offline (losing it blocks updates
#    unless Play App Signing is enabled — enable it in Play Console, recommended).
keytool -genkeypair -v -keystore conz-upload.jks -alias conz-upload \
        -keyalg RSA -keysize 4096 -validity 10000

# 2. Build (JDK 21 + Android SDK)
npm ci && npx cap sync android
cd android
export CONZ_KEYSTORE_PATH=/secure/path/conz-upload.jks CONZ_KEYSTORE_PASSWORD=*** CONZ_KEY_ALIAS=conz-upload CONZ_KEY_PASSWORD=***
./gradlew bundleRelease -PversionCode=1 -PversionName=1.0.0
# -> android/app/build/outputs/bundle/release/app-release.aab
```

Test the release build on a real device before uploading (sign-in with e-mail + Google, Paynow page opens and
returns, camera upload for delivery photo / KYC, location prompt, push notification, account deletion).

## 3. App Links (recommended before launch, completes H8)

After Play App Signing is set up, copy the **app signing certificate SHA-256** from Play Console → App integrity,
then:
1. Serve `https://www.conz.co.zw/.well-known/assetlinks.json`:
   `[{"relation":["delegate_permission/common.handle_all_urls"],"target":{"namespace":"android_app","package_name":"com.conz.app","sha256_cert_fingerprints":["<SHA-256>"]}}]`
2. Add an `autoVerify="true"` https intent-filter for `www.conz.co.zw/oauth-callback`, switch the native
   `redirectTo` to `https://www.conz.co.zw/oauth-callback`, add it to Supabase Auth redirect URLs.
Do **not** publish a placeholder fingerprint.

## 4. Play Console declarations (draft answers — owner must confirm)

**Data safety** (data collected / shared / purpose / encrypted in transit: yes / deletion: in-app + on request):

| Data | Collected | Shared with | Purpose |
|---|---|---|---|
| Name, e-mail, phone | Yes | Counterparty on a job (name/phone during active jobs) | Account, communications |
| Precise location | Yes (driver during active jobs; customer delivery pin) | Customer of the job (driver live location) | App functionality |
| Photos (delivery evidence, KYC documents) | Yes | Admins (KYC), job parties (evidence) | Fraud prevention, app functionality |
| Government ID number / ID document | Yes (drivers) | Not shared | Identity verification |
| Financial info: payment / wallet history | Yes | Paynow (payment processor) | Payments |
| Audio (chat voice notes) | Yes (optional) | Job counterparty | App functionality |
| Device / push tokens | Yes | Firebase Cloud Messaging | Notifications |

- **Account deletion:** in-app at Profile → Delete account; web URL for the listing: `https://www.conz.co.zw/privacy`
  (section 7 explains deletion and retention). Financial/audit records are retained, anonymised.
- **Financial features:** wallet top-ups and escrow payments via Paynow (licensed Zimbabwean processor); no
  lending / crypto. Expect the "Financial features" declaration.
- **Permissions justification:** CAMERA (delivery proof photos, driver documents); ACCESS_FINE/COARSE_LOCATION
  (live delivery tracking, location-stamped evidence — foreground only, **no background location**);
  POST_NOTIFICATIONS (job/payment notifications); INTERNET.
- **Prominent disclosure for location** is required before the first location prompt (the app's
  `LocationPrivacyCard` exists — confirm it is shown before the OS dialog on Android).
- **Content rating:** questionnaire (no violence / UGC beyond chat between job parties; chat has contact-sharing flags).
- **Target audience:** 18+ (business users); not designed for children.

## 5. Store listing checklist

- [ ] App name "Con Z", short description (≤80 chars), full description
- [ ] 512×512 icon (`assets/icon.png` source), 1024×500 feature graphic
- [ ] ≥2 phone screenshots (customer booking, driver job feed, tracking, wallet) — capture from the release build
- [ ] Privacy policy URL `https://www.conz.co.zw/privacy` (owner/legal review of the 08/10 wording)
- [ ] Support e-mail / website
- [ ] Closed testing track first (internal testers), then production

## 6. Review risk

A WebView shell can be rejected as "low native value". Mitigations already present: native push (FCM), camera,
location permission flows, custom splash/icon, native OAuth bridge. Make sure the app is fully usable, has no
broken links, and that the Paynow flow returns to the app.
