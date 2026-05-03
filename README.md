<div align="center">

# 🗑️ Neu-Ulm Müllkalender

**Multilingual Expo / React Native app for waste collection schedules in Neu-Ulm, Bavaria.**
Runs on **iOS, Android and Web** from a single codebase.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Ko-fi](https://img.shields.io/badge/Support-Ko--fi-FF5E5B?logo=ko-fi)](https://ko-fi.com/aminoste)
[![Expo](https://img.shields.io/badge/Expo-SDK%2055-000020?logo=expo)](https://expo.dev)
[![React Native](https://img.shields.io/badge/React%20Native-0.83-61DAFB?logo=react)](https://reactnative.dev)

</div>

---

## ✨ What it does

Pick your address once and the app shows you exactly when Restmüll, Biotonne, Gelber Sack, Papiertonne, and Grüngut are collected at your house — based on the **official Stadt Neu-Ulm Abfallkalender**. The full 2026 calendar (521 events across all 8 Abfuhrbezirke) is baked into the app, so it works offline on day one. The app then keeps itself up to date automatically by re-fetching the city's published ICS files in the background.

---

## 🧭 Features

| | |
|---|---|
| 📅 | Calendar **and** list views for upcoming collection dates, with the next pickup as a hero card |
| 📍 | Auto-detect Bezirk via **GPS** or **address search** (Nominatim / OpenStreetMap) |
| 🗺️ | Interactive **OpenStreetMap** with all recycling locations (Wertstoffhöfe, Glascontainer, Altkleider, Grüngut, …) |
| 🚗 | "Route planen" buttons open **Google Maps** routing from your live location |
| 🔔 | Local push notifications — reminds you the **evening before** every collection |
| 🌍 | **8 languages**: Deutsch, English, Türkçe, Français, Español, Русский, العربية, हिन्दी |
| 📂 | Manual `.ics` import (works on web too) for users in neighbouring municipalities |
| ♻️ | All **8 Abfuhrbezirke** of Neu-Ulm with the official 2026 calendar baked in |
| 🔄 | Background refresh from `nu.neu-ulm.de` every 7 days, hard-refresh after 30 days |
| 🛟 | Falls back to baked-in 2026 data automatically when the city site is unreachable |

---

## 🏗 Architecture

### State

`lib/appState.tsx` exposes a single React Context that owns every piece of user state. All tabs subscribe via `useAppState()` and re-render automatically when anything changes.

```
districtId · address · coords · districtAutoDetected
notificationsEnabled · reminderTime
```

The single most important update API is:

```ts
applyDetectedLocation({
  districtId,
  address,        // full text, e.g. "Lupinenweg 25, 89233 Neu-Ulm, Pfuhl"
  coords,         // [lat, lon]
  autoDetected,   // true for GPS / address-search, false for manual pick
});
```

This writes all four values **atomically** (one render, one persist round-trip), so the Home, Map, and Settings tabs always show the same data. Updates persist to `AsyncStorage` in a single `Promise.all` so a crash mid-write can't leave stale partials behind.

### Calendar data

```
lib/icsParser.ts        RFC 5545–compliant parser (line unfolding, all DTSTART
                        forms, German variant classifier — Restmüll, Biotonne,
                        Hausmüll, Bioabfall, Wertstofftonne, Gelber Sack,
                        Papiertonne, Altpapier, Grüngut, Gartenabfall, …).

lib/calendar2026.ts     Auto-generated module — 8 ICS strings (one per Bezirk),
                        extracted directly from the official city PDF
                        (Stadt Neu-Ulm Abfallkalender 2026, Nov 2025 issue).
                        521 events total, 26 R/B + 26 GS + 13 P per Bezirk.
                        Re-build with: scripts/build_calendar.py.

lib/dataFetcher.ts      Cache-first fetch. On every call the app tries:
                          1.  Soft-fresh (<7d) cache  → return + refresh in BG
                          2.  Hard-stale (>30d)      → fetch fresh, await
                          3.  Fresh fetch failed     → serve stale cache
                          4.  No cache + no network  → user-imported .ics
                          5.  Last resort           → BUILT-IN 2026 calendar
                        The result: the calendar is **never** empty.
```

### District detection

```
lib/stadtteile.ts       The 19 Neu-Ulm Stadtteile from the official PDF, each
                        with name + aliases + centroid + assigned Bezirk.

lib/districtDetector.ts Two complementary functions:
                          detectDistrictFromAddress(addr, lat, lon)
                            — matches Nominatim's suburb / city_district /
                              neighbourhood / hamlet against the Stadtteil
                              index. Most reliable for Pfuhl-Nord vs -Süd
                              and the rural Stadtteile (Reutti, Holzschwang…).
                          detectDistrictFromCoordinates(lat, lon)
                            — fallback by haversine distance to centroids;
                              returns null only for points >6 km from any
                              centroid (i.e. clearly outside Neu-Ulm).
                        Pfuhl is disambiguated by latitude (split @ 48.420°N).
```

### Folder layout

```
app/
  _layout.tsx              Root layout — LogBox filter, providers, ErrorBoundary
  (tabs)/
    _layout.tsx            Tab bar configuration
    index.tsx              Home — calendar + list view, next-pickup hero card
    map.tsx                Map (native) — WebView + Leaflet + OSM
    map.web.tsx            Map (web)    — iframe + Leaflet + OSM
    settings.tsx           Settings — manual Bezirk picker, notifications,
                           language, ICS import. (Address detection lives
                           on the Map tab.)

lib/
  appState.tsx             Shared context: district, address, coords,
                           notifications, reminderTime, districtAutoDetected
                           + applyDetectedLocation()
  calendar2026.ts          Built-in 2026 ICS data (auto-generated)
  constants.ts             BEZIRKE list (8 districts)
  dataFetcher.ts           ICS fetch + Nominatim wrapper + 30-day cache
                           + formatNominatimAddress() helper
  districtDetector.ts      Address → Bezirk + coords → Bezirk
  i18n.tsx                 8-language context (no I18nManager.forceRTL)
  icsParser.ts             RFC 5545 parser
  locations.ts             ~300 recycling locations (OSM data)
  notificationScheduler.ts expo-notifications scheduler (Android channel aware)
  stadtteile.ts            Stadtteile → Bezirk mapping (from official PDF)
  storage.ts               AsyncStorage wrapper

api/
  server.ts                Express CORS proxy — bridges ICS + Nominatim for web

scripts/
  parse_calendar_pdf.py    PDF → events JSON (run yearly when city publishes
                           the next year's Abfallkalender)
  build_calendar.py        events JSON → lib/calendar2026.ts module

components/
  ErrorBoundary.tsx        React error boundary
```

---

## 🚀 Quick start

### Prerequisites

- **Node 20+** and **npm 10+**
- **Expo CLI** (we use the local `npx expo`, no global install needed)
- For native testing: **Expo Go** on your phone, _or_ Android Studio / Xcode for emulators
- For app-store submission: an **EAS account** (free at [expo.dev](https://expo.dev))

### Install + run

```bash
git clone https://github.com/aminoste/neu-ulm-muellkalender.git
cd neu-ulm-muellkalender
npm install

# 1. Native (Expo Go)
npx expo start --clear     # scan the QR with Expo Go

# 2. Native simulator/emulator
npx expo start --ios
npx expo start --android

# 3. Web (browser)
cp .env.example .env       # set EXPO_PUBLIC_API_URL=http://localhost:3001
npm run api                # in one terminal: Express CORS proxy on :3001
npx expo start --web       # in another:      http://localhost:8081
```

> **Always pass `--clear`** after a config or `metro.config.js` change — Metro caches aggressively and stale cache is the source of most "it still crashes" reports.

### Local dev tips

- **Where's my address?** Open the **Map** tab and tap either 🔍 (search) or 📍 (Standort ermitteln). Both auto-detect your Bezirk and propagate to the Home and Settings tabs in one frame.
- **No network?** The app still shows the full 2026 calendar from `lib/calendar2026.ts`.
- **Notifications.** In Expo Go, local scheduled reminders work; remote push tokens don't (the app filters that warning so it isn't noisy). For real push, use a dev build (`eas build --profile development`).

---

## 📦 Building with EAS

This project ships with a `eas.json` containing three profiles: `development`, `preview`, and `production`.

### One-time setup

```bash
npm i -g eas-cli                          # install the EAS CLI
eas login                                 # log in with your Expo account
eas init --id <your-project-id>           # creates .extra.eas.projectId in app.json
```

Open `eas.json` and `app.json` and fill in:

```jsonc
// app.json
"extra": {
  "apiUrl": "https://your-api-server.example.com",
  "eas": { "projectId": "00000000-0000-0000-0000-000000000000" }
}
```

```jsonc
// eas.json — submit.production.ios
"appleId":     "you@example.com",
"ascAppId":    "1234567890",   // App Store Connect app ID (after you create the app)
"appleTeamId": "ABCDE12345"
```

```jsonc
// eas.json — submit.production.android
"serviceAccountKeyPath": "./google-play-key.json",  // Google Play service-account JSON
"track": "production"
```

The Google Play key file is **not** committed (`.gitignore` already excludes `*.json` keys). Generate it once in the Google Play Console under _Setup → API access → Service accounts_.

### Development build (with developer client)

A development build replaces Expo Go and lets you test push notifications, custom native modules, and release-candidate features.

```bash
eas build --profile development --platform android   # APK — install on any Android device
eas build --profile development --platform ios       # IPA — install via TestFlight
```

Once installed, run `npx expo start --dev-client` and scan the QR.

### Preview build (internal distribution APK / IPA)

Use this for sharing a release-quality build with testers without going through the stores.

```bash
eas build --profile preview --platform android       # signed APK
eas build --profile preview --platform ios           # ad-hoc IPA (requires Apple devices registered in EAS)
```

EAS prints a download URL when the build finishes.

### Production build (Play Store / App Store)

```bash
eas build --profile production --platform android    # AAB for Google Play
eas build --profile production --platform ios        # IPA for App Store
eas build --profile production --platform all        # both at once
```

`production.autoIncrement: true` increments `versionCode` / `buildNumber` on every build, so you don't have to bump them by hand.

### Web build (static hosting)

```bash
npx expo export --platform web                       # output: ./dist/
```

The `dist/` directory is a fully self-contained static site (Vercel, Netlify, S3+CloudFront, GitHub Pages, …). The web build talks to the Express CORS proxy via `EXPO_PUBLIC_API_URL`, so deploy that proxy somewhere reachable (Cloudflare Workers, Render, Fly.io, …) and set the env var at build time.

---

## 🛒 Submitting to the stores

After a successful production build:

```bash
npm run submit:android      # uploads the AAB to Google Play (production track)
npm run submit:ios          # uploads the IPA to App Store Connect

# OTA fix without a rebuild:
npm run update              # ships a bundle update via EAS Update
```

### iOS first-time checklist

1. Create the bundle ID `de.neuulm.muellkalender` in [Apple Developer](https://developer.apple.com).
2. Create the app in App Store Connect, copy the numeric **App ID** into `eas.json` as `ascAppId`.
3. Add your **Apple Team ID** (top-right of Apple Developer) to `eas.json` as `appleTeamId`.
4. EAS will prompt for credentials on first submit — accept the auto-generated provisioning + APNs cert.

### Android first-time checklist

1. Create the app entry in [Google Play Console](https://play.google.com/console) with package name `de.neuulm.muellkalender`.
2. Set up a service account under _Setup → API access_, download the JSON key, place it at `./google-play-key.json`.
3. First submission must go to the **Internal testing** track manually (Play Store policy). After Google approves the listing, future submits with `track: "production"` work automatically.

---

## 🔄 Updating the calendar (yearly, when the city publishes a new PDF)

The Stadt Neu-Ulm typically releases the next year's PDF in November / December. To regenerate the built-in fallback:

```bash
# 1. Drop the new PDF into ./data/  (e.g. Neu-Ulm_Abfallkalender-2027_Web.pdf)

# 2. Update scripts/parse_calendar_pdf.py:
#      - PDF path
#      - GRIDS line indices (run pdftotext -layout once and find the
#        "Januar"/"Juli" header lines, plus the "Wertstoffhof am …" footers)

python3 scripts/parse_calendar_pdf.py     # produces /tmp/abfall_events.json
python3 scripts/build_calendar.py         # regenerates lib/calendar2026.ts

# 3. Rename the module if you want (calendar2027.ts) and update the import in
#    dataFetcher.ts — or keep the calendar2026.ts name as a rolling alias.

# 4. Sanity-check — should print 26 R/B + 26 GS + 13 P per Bezirk.
```

---

## 🐞 Troubleshooting

### `expo-notifications: Android Push notifications … was removed from Expo Go`

Harmless. We use only local scheduled notifications (which still work in Expo Go). The warning is filtered out by `LogBox.ignoreLogs` in `app/_layout.tsx`. It vanishes entirely in dev / production builds.

### `TypeError: window.addEventListener is not a function` on Android

Fixed in `metro.config.js`:

```js
config.resolver.unstable_conditionNames = ["react-native", "require", "default"];
finalConfig.resolver.sourceExts = finalConfig.resolver.sourceExts
  .filter((ext) => !ext.startsWith("web."));
```

After any `metro.config.js` change, restart with `--clear`.

### `space-y-* is deprecated` warning, then `Couldn't find a navigation context`

NativeWind v4 dropped `space-y-*`/`space-x-*`. The runtime tries to JSON-stringify the component tree to print an upgrade warning, and stringification triggers a navigation-context getter that throws. Replace with `gap-N` on the parent View — RN Views default to `flex-direction: column`, so spacing is identical.

### Address search returns no results on web

1. The Express proxy must be running (`npm run api`) and `EXPO_PUBLIC_API_URL` set.
2. Browsers block setting `User-Agent` via `fetch()`. The app already detects `Platform.OS === "web"` and omits the header — _do not_ try to add it back; it'll throw a `TypeError`.

### "Auto location detection does not work"

Open the dev console — `[Map] handleLocate` and `[Map] suggestion selected` log every step. The most common causes:

| Symptom | Fix |
|---|---|
| Permission alert never shows | App-level location permission is already denied at the OS layer. Toggle in Settings → Apps → Müllkalender → Permissions → Location. |
| Spinner spins forever on Android | Cold-start GPS chip. The 20 s hard timeout will surface a clear error. Try outdoors / near a window. |
| Always falls back to "Außerhalb von Neu-Ulm" | You're outside the 6 km centroid bound. Pick the Bezirk manually in Settings. |
| Web: nothing happens after tapping 📍 | Browser blocked geolocation. Click the 🔒 icon in the address bar → Site settings → Location → Allow. |

### ICS import fails on web

`expo-file-system` isn't available on web. The handler branches on `Platform.OS === "web"` and reads via `fetch(asset.uri)` instead.

### Notification toggle does nothing

In Expo Go on iOS, real notifications never fire (Apple restricts that to dev builds). Build a dev client with `eas build --profile development --platform ios` to test reminders end-to-end.

---

## 🌐 Data sources & licences

| Data | Source | Licence |
|------|--------|---------|
| Calendar dates | [Stadt Neu-Ulm Abfallkalender 2026 PDF](https://nu.neu-ulm.de/buerger-service/leben-in-neu-ulm/abfall-sauberkeit/abfallkalender) | © Stadt Neu-Ulm |
| Stadtteile mapping | The same PDF, page 3 | © Stadt Neu-Ulm |
| Geocoding | [Nominatim / OpenStreetMap](https://nominatim.org/) | ODbL |
| Map tiles | [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) | ODbL |
| Recycling locations | OpenStreetMap (Landkreis Neu-Ulm) | ODbL |
| District boundaries | Manually digitised + cross-checked with the city PDF | This project, MIT |

The code in this repository is MIT-licensed (`LICENSE`). Calendar dates and Stadtteile lists are the city of Neu-Ulm's public data; this project does not modify them.

---

## 🤝 Contributing

PRs welcome — especially translations, new recycling locations from OpenStreetMap, and updated Stadtteile boundaries when the city publishes a new map. Please run `npm run type-check` before submitting (note: requires bumping `typescript` to `~5.4.0` because `expo/tsconfig.base` uses `module: "preserve"` which TS 5.3 can't parse).

If you find a bug, please attach the relevant `[Map] handleLocate` / `[Map] suggestion selected` console output.

---

## 💚 Support

If this app saves you from missing one Restmüll pickup, that's already a win. If you'd like to say thanks:

[![Ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/aminoste)

---

© 2026 Mohamed Amine Guedria · MIT Licence · Built with Expo + React Native
