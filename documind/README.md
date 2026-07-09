# DocuMind

> **Build status:** verified — `npm install`, `tsc --noEmit`, and Metro bundling
> for **web and Android** all pass on a clean checkout. A committed
> `package-lock.json` pins the exact versions that were tested.

A clean, document-digitization app for React Native (Expo). Scan or import a
document and DocuMind reads it, sorts it by topic, flags the things that matter
(deadlines, payments, critical issues), saves it locally on your device, and
lets you ask questions across everything with a retrieval-augmented chatbot and
a knowledge graph.

> This is a standalone project. It does **not** depend on anything else in the
> repository it currently lives in — see *“Moving this into its own repo”* below.

---

## What it does

| Feature | How |
| --- | --- |
| **Scan / upload** | A real document scanner with **automatic edge-detection**, multi-page capture, and **PDF output**; plus photo import and file import (image / PDF / text). |
| **OCR — the modern way** | No separate OCR engine. The page image is sent straight to a **vision model**, which transcribes the text *and* understands it in one pass. |
| **Classification** | Each document is sorted into a topic (Finance, Legal, Medical, Insurance, …). |
| **Highlights** | Deadlines, payments, critical problems and required actions are extracted and flagged with a severity. |
| **Local storage** | Document metadata + analysis live in on-device storage; page images are copied into the app's document directory. |
| **RAG chatbot** | Ask questions; the backend retrieves the most relevant passages (vector search) and answers with citations. |
| **Knowledge graph** | Entities (people, organizations, amounts, dates) extracted from your documents, linked by how they relate. |
| **Deadline alerts** | On-device reminders are scheduled automatically for detected deadlines (2 days before + on the day), so bureaucratic due-dates don't slip. |

### A note on the OCR “new approach”

The link in the original request was a wrapped `lnkd.in` redirect that couldn't
be resolved, so the exact article isn't known. DocuMind implements what is now
the state-of-the-art approach to document OCR: **send the page to a
vision-capable LLM and let it transcribe + understand in a single call**, rather
than running a classical OCR engine (Tesseract et al.) and post-processing the
text. This is what makes one-pass OCR + classification + extraction possible.
If your link pointed to a specific OCR API, swap it in inside
[`server/src/ai.ts`](server/src/ai.ts) — that's the only file that talks to the
model.

---

## Architecture

```
┌──────────────────────────┐        HTTPS/JSON        ┌────────────────────────────┐
│  Expo app (this folder)   │ ───────────────────────► │  server/  (Node + Express)  │
│                          │                          │                            │
│  • Camera / import        │   /api/analyze           │  • Vision OCR + analysis    │
│  • Local document store   │   /api/index             │  • Embeddings + vector RAG  │
│  • Highlights & graph UI  │   /api/chat              │  • Holds the AI provider key │
│  • RAG chat UI            │ ◄─────────────────────── │                            │
└──────────────────────────┘                          └─────────────┬──────────────┘
                                                                     │ OpenAI-compatible
                                                                     ▼
                                                       OpenAI / ChatGPT / kit.ai gateway
```

The app never holds the AI key — it talks only to your backend. The backend is
**provider-flexible**: it uses the OpenAI SDK, which speaks the
OpenAI-compatible protocol, so it works against OpenAI/ChatGPT directly or any
compatible gateway (point `AI_BASE_URL` at your kit.ai endpoint).

---

## Document scanner (important)

There are two layers here:

- **The live camera** (capture pages, multi-shot) uses **`expo-camera`** and
  works **everywhere** — Expo Go and the web browser included. This is the
  default “Scan document” behavior. (The old build used the OS image-picker,
  which on web only opened a file-upload dialog — that's now fixed.)
- **Automatic edge-detection + PDF export** use **`react-native-document-scanner-plugin`**
  and **`expo-print`**, which are **native modules** — not present in Expo Go or
  on web. To get those you need a **development build** (below). Without it, the
  camera still captures pages and the document is still read and classified; you
  just don't get auto-crop or a saved PDF.

To enable the full scanner (auto edge-detection + PDF), pick one of the two
paths below.

### Path A — Cloud build with EAS (no Android SDK to install) ✅ easiest

`npx expo run:android` fails with *“Failed to resolve the Android SDK path / 'adb'
is not recognized”* when you don't have Android Studio installed. EAS builds the
dev client in the cloud instead, so you never install the Android SDK locally:

```bash
npm install -g eas-cli
eas login                                   # free Expo account
eas build --profile development --platform android
```

When it finishes, EAS gives you a QR code / link — install that **.apk** on your
Android phone. Then run the JS bundle and open it in that app:

```bash
npx expo start --dev-client
```

(An `eas.json` with a `development` profile is already included.)

### Path B — Local build (requires Android Studio)

Install **Android Studio**, then set the SDK location so `adb` and the build
tools are found:

```powershell
# Windows (PowerShell) — adjust the path to your SDK
setx ANDROID_HOME "$env:LOCALAPPDATA\Android\Sdk"
setx PATH "$env:PATH;$env:LOCALAPPDATA\Android\Sdk\platform-tools"
# open a NEW terminal so the vars take effect, then:
npx expo run:android
```

For iOS you need a Mac with Xcode (`npx expo run:ios`).

In that dev build, **Scan document** opens the native scanner: line up the page,
the edges are detected automatically, add more pages, then finish — DocuMind
stitches them into a PDF and analyzes them. In Expo Go / web it falls back to
the system camera so the button still works (no auto-crop, single page).

> Tip: `npx expo install …` picks the versions that match your Expo SDK — prefer
> it over the pinned versions in `package.json` if `npm install` warns about
> mismatches.
>
> If `expo prebuild` complains that `react-native-document-scanner-plugin` has no
> config plugin (older versions), remove the `"react-native-document-scanner-plugin"`
> line from `app.json` → `plugins` and add the camera permission manually — the
> module still autolinks.

## Getting started

### 1. Backend

```bash
cd server
cp .env.example .env       # then fill in AI_API_KEY (and AI_BASE_URL for kit.ai)
npm install
npm run dev                # starts on http://localhost:3001
```

`.env` keys (defaults are set for the **KIT ki-toolbox**):

- `AI_API_KEY` — your provider key (for KIT, your `OPENAI_API_KEY`).
- `AI_BASE_URL` — OpenAI-compatible base URL. Default: `https://ki-toolbox.scc.kit.edu/api/v1`. Leave blank to use OpenAI directly.
- `AI_MODEL` — chat/vision model. Default `openai/azure.gpt-4.1` (supports image input, so scanning works).
- `AI_EMBED_MODEL` — embedding model for retrieval. **Leave blank if your gateway has no embeddings endpoint** — the server automatically falls back to keyword retrieval, so the chatbot still works (just with simpler ranking).

### 2. App

```bash
# from the documind/ folder
cp .env.example .env        # optional: set EXPO_PUBLIC_API_URL
npm install
npm start                   # press i / a, or scan the QR with Expo Go
```

Then open **Settings** in the app and set the **Backend URL**:

- Simulator/emulator on the same machine → `http://localhost:3001`
- Physical phone → your computer's LAN IP, e.g. `http://192.168.1.20:3001`

Tap **Test connection** to confirm.

---

## Using it

1. **Scan** → take a photo / import a file. DocuMind analyzes it and opens the result.
2. **Library** → all documents, with the next deadline and any critical items surfaced at the top.
3. **Document detail** → summary, highlights (deadlines / payments / critical / actions), entities, and the full extracted text.
4. **Ask** → chat across everything; answers cite the documents they came from.
5. **Graph** → the entities and relationships found across your library.

---

## Privacy

- Documents and their analysis are stored **locally** on the device.
- Page images are sent to your backend (and onward to your AI provider) at scan
  time for transcription. For chat, only the **retrieved text passages** relevant
  to your question are sent — not your whole library.

---

## Moving this into its own repo

This folder is fully self-contained. To make it a standalone repository:

```bash
# from inside the documind/ folder
cp -R . /path/to/new/documind-app
cd /path/to/new/documind-app
git init && git add . && git commit -m "Initial commit: DocuMind"
# then create an empty repo on GitHub and push
```

(The app and the backend are two npm projects: the Expo app at the root of this
folder, and the server under `server/`.)

---

## Tech

- **App:** Expo + Expo Router, TypeScript, react-native-svg, lucide-react-native. Plain StyleSheet design system (`src/lib/theme.ts`).
- **Backend:** Node + Express, OpenAI SDK (OpenAI-compatible), JSON-file vector store.
