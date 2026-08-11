# Building the Con Z Android app

This project is now wrapped for Android via Capacitor. The native app is a
thin shell — it loads the live app at `https://conz-build-connect.vercel.app`
directly (see `capacitor.config.ts`), the same way a browser would. This is
because Con Z is a server-rendered app (Paynow handling, admin actions, etc.
run on Vercel) — those can't be bundled onto a phone, so the app just needs
network access to the real backend, same as it does today on mobile web.

What this setup already gives you:
- A real installable Android app with its own icon and splash screen
- Proper Android permission prompts for camera (photo uploads) and location
  (live tracking) instead of relying on browser permission prompts
- Everything needed to build a `.aab` file for the Play Store

## What's left — needs a real computer, not this sandbox

Building and signing the final app requires **Android Studio** running
locally. This can't be done from here — Google's Android build tools need a
real machine (Windows, Mac, or Linux).

### 1. Install Android Studio
Download from https://developer.android.com/studio — free, no account needed
beyond a Google account for signing later.

### 2. Get the code onto your computer
```
git clone https://github.com/munesuishemichaelmashodo-droid/conz-build-connect.git
cd conz-build-connect
npm install
```

### 3. Open the Android project
```
npx cap open android
```
This launches Android Studio directly into the `android/` folder already set
up in this repo. Let it finish syncing Gradle the first time (can take a
few minutes).

### 4. Test it on your phone first
- Plug your Android phone in via USB, enable Developer Options + USB
  debugging on it (search "how to enable USB debugging Android" if unsure)
- In Android Studio, hit the green "Run" (▶) button, select your phone
- The app should open and load Con Z exactly like the web version does

### 5. Build the release file for the Play Store
This is the one step with real stakes — Google requires every app to be
signed with a **keystore** (a private signing key), and **you must keep this
file and its password safe forever**. If you lose it, you can never update
this app again on the Play Store — you'd have to publish as a brand new app
and lose all reviews/installs.

In Android Studio:
1. **Build → Generate Signed Bundle / APK**
2. Choose **Android App Bundle (.aab)** — this is what Google Play wants,
   not a plain `.apk`
3. Click **Create new...** to make a new keystore (first time only)
   - Fill in a strong password, your name/organization details
   - **Save the keystore file (.jks) somewhere safe — back it up.** Also
     save the password somewhere safe (a password manager, not just memory)
4. Select **release** build variant, finish the wizard
5. Android Studio produces the `.aab` file — this is what you upload to the
   Google Play Console

### 6. Google Play Console
- Sign up at https://play.google.com/console — one-time **$25 registration
  fee**, paid once, covers all future apps forever
- Create a new app, fill in the store listing (description, screenshots,
  privacy policy link — Con Z already has `/privacy`)
- Complete the **Data Safety** section honestly: location, camera/photos,
  financial info (Paynow), identity documents (driver verification)
- Upload the `.aab` file
- Submit for review (Google's review typically takes a few days to a couple
  weeks for a new developer account)

## Updating the app later

Because this is a remote-URL setup, most changes to Con Z (new features, bug
fixes, UI changes) **don't require a new Play Store release at all** — they
just deploy to Vercel like normal, and the app picks them up automatically
next time it loads, same as refreshing a webpage.

You only need to rebuild and resubmit through Android Studio when:
- The app icon, splash screen, or name changes
- Android permissions change (e.g. adding a new native capability)
- The `capacitor.config.ts` itself changes (e.g. the app URL)
