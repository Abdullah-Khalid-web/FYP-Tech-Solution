# ManageHub Mobile App

This is a **hybrid app shell** (Capacitor) — it doesn't reimplement the UI, it wraps
the existing ManageHub web dashboard in a real installable Android/iOS app. When a
user opens the app, it loads your live server's pages directly inside a native
WebView (configured in `capacitor.config.json` → `server.url`), so logins, sessions,
and all data are identical to the web version — no separate backend or API needed.

## Phase 1 scope (already wired up on the server side)

The mobile app currently shows a reduced nav and is **view-only** for
Products, Sales, Customers, Suppliers, Employees, Reports, and Feedback.
Settings and My Profile are fully editable. This isn't a mobile-app setting —
it's enforced server-side in `middleware/mobileApp.js`, keyed off a custom
User-Agent token (`ManageHubMobileApp/1.0`) that this app appends to every
request (see `appendUserAgent` in `capacitor.config.json`). To expand what's
editable on mobile later, edit the `mobileReadOnly` middleware calls in `app.js`
and the `mobileReadOnlyPrefixes` list in `views/layouts/layout.ejs`.

## Before you build: point it at your real server

Edit `capacitor.config.json` and replace the placeholder:

```json
"server": { "url": "https://YOUR-DEPLOYED-DOMAIN.example.com" }
```

with your actual deployed HTTPS URL (the app needs the *real* production/staging
server — an app store build can't reach `localhost` on your dev machine).

### Testing locally against your dev server (before you have a deployment)

- **Android emulator**: use `http://10.0.2.2:3000` (the emulator's alias for your
  host machine's `localhost`), and temporarily set `"cleartext": true` in the
  `server` block (plain HTTP is blocked by default). Switch back to your real
  HTTPS domain with `cleartext: false` before shipping.
- **Physical Android/iOS device on the same WiFi**: use `http://<your-computer's-LAN-IP>:3000`
  (e.g. `http://192.168.1.20:3000`), same `cleartext: true` note as above.
- After changing the config, run `npm run sync` to push it into both native projects.

## Building for Android (works on Windows/Mac/Linux)

1. Install [Android Studio](https://developer.android.com/studio) (bundles the JDK
   and Android SDK you need — neither is installed on this machine yet).
2. From this `mobile/` folder: `npm install` (already done), then `npm run open:android`
   — this opens the `android/` project in Android Studio.
3. Let Gradle sync, then Run ▶ on an emulator or a plugged-in device.
4. For a real Play Store build: Build → Generate Signed Bundle/APK in Android Studio.

## Building for iOS (requires a Mac — cannot be done on this Windows machine)

1. On a Mac, install Xcode and [CocoaPods](https://cocoapods.org/) (`sudo gem install cocoapods`).
2. Copy this whole `mobile/` folder to the Mac (or clone the repo there), run `npm install`,
   then `npx cap sync ios` (this runs the `pod install` step that was skipped here).
3. `npm run open:ios` opens `ios/App/App.xcworkspace` in Xcode. Run on the Simulator
   or a device (needs an Apple Developer account for device installs / App Store).

If you don't have access to a Mac, a cloud Mac CI service (e.g. Codemagic, Bitrise,
GitHub Actions macOS runners) can build and even auto-submit to TestFlight without
you owning physical Apple hardware.

## Customizing app icon, splash screen, and name

- App name: `appName` in `capacitor.config.json` (already set to "ManageHub").
- Icon/splash: replace the placeholder images Capacitor generated under
  `android/app/src/main/res/` and `ios/App/App/Assets.xcassets/`, or use the
  `@capacitor/assets` generator (`npx @capacitor/assets generate`) by dropping a
  1024×1024 `icon.png` and a `splash.png` into an `assets/` folder here.

## Re-syncing after config or plugin changes

Whenever you edit `capacitor.config.json` or add a Capacitor plugin:

```
npm run sync
```

This copies the updated config/web assets into both `android/` and `ios/` — it's
already been run once, so both platforms are in sync with the current config.
