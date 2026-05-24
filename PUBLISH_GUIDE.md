# Neu-Ulm Müllkalender — EAS Publish Guide (v1.4.0)

> **All code changes are committed and pushed to `main`.**  
> Follow the steps below in your terminal to build and publish.

---

## Prerequisites

| Tool | Check command | Install |
|------|--------------|---------|
| Node ≥ 18 | `node -v` | https://nodejs.org |
| npm ≥ 9 | `npm -v` | bundled with Node |
| EAS CLI | `eas --version` | `npm install -g eas-cli` |
| Expo account | — | https://expo.dev/signup |

---

## Step 1 — Login to EAS

```bash
npx eas-cli login
# enter your Expo account email: guedria.amine@gmail.com
# enter your password
```

---

## Step 2 — Init / link the EAS project

This creates a project on expo.dev and writes the `projectId` into `app.json`.

```bash
cd D:\workspace\neu-ulm-muellkalender-fixed\neu-ulm-app
npx eas-cli init
# choose "Create a new EAS project" if prompted
# The tool will update app.json → extra.eas.projectId automatically
```

Commit the updated `app.json` afterwards:

```bash
git add app.json
git commit -m "chore: add EAS projectId"
git push origin main
```

---

## Step 3 — Build for Android (APK / AAB)

### Internal preview (APK, no Play Store needed)
```bash
eas build --platform android --profile preview
```
You'll get a download link for the `.apk` you can install directly.

### Production (AAB for Google Play)
```bash
eas build --platform android --profile production
```

---

## Step 4 — Build for iOS

> Requires an **Apple Developer** account ($99/year).

```bash
eas build --platform ios --profile production
```

EAS will guide you through:
- Signing certificate setup
- Provisioning profile
- App Store Connect API key

---

## Step 5 — Submit to stores

### Google Play

1. Create a service account key in Google Play Console:  
   **Setup → API access → Create service account**
2. Download the JSON key and save as `google-play-key.json` in the project root.
3. Run:
```bash
eas submit --platform android
```

### App Store (iOS)

Fill in `eas.json` → `submit.production.ios`:
```json
{
  "appleId":    "guedria.amine@gmail.com",
  "ascAppId":   "<your-app-id-from-appstoreconnect>",
  "appleTeamId":"<your-10-char-team-id>"
}
```

Then:
```bash
eas submit --platform ios
```

---

## OTA Updates (no re-install needed)

For hot-fixes that don't need a full app-store review, use **EAS Update**.

1. Install the package:
```bash
npx expo install expo-updates
```
2. Push an update:
```bash
eas update --branch production --message "Fix: data refresh"
```

Users get the update the next time they open the app.

---

## Quick reference — most common commands

```bash
# Check build status
eas build:list

# Download a specific build
eas build:download --id <build-id>

# View project on expo.dev
eas open

# Cancel a running build
eas build:cancel --id <build-id>
```

---

## What changed in v1.4.0

| Feature | Where |
|---------|-------|
| ↺ **Manual Refresh button** | Home header (right side) |
| 🕐 **"Last updated: X ago"** | Home header below Bezirk badge |
| 📅 **Monthly auto-refresh** | Triggers silently on app start if data > 28 days old |
| ✅ **In-app toast feedback** | Success / error / info — no more blocking alerts |
| 🔔 **Notifications re-scheduled** after each refresh | Automatic |
| 🗄️ **Settings → Data section** | Shows last-update time + manual refresh button |
| 🌍 All new text in 8 languages | de, en, tr, ar, fr, hi, es, ru |
