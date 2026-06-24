# DocuMind

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
| **Scan / upload** | Camera capture, photo import, or file import (image / PDF / text). |
| **OCR — the modern way** | No separate OCR engine. The page image is sent straight to a **vision model**, which transcribes the text *and* understands it in one pass. |
| **Classification** | Each document is sorted into a topic (Finance, Legal, Medical, Insurance, …). |
| **Highlights** | Deadlines, payments, critical problems and required actions are extracted and flagged with a severity. |
| **Local storage** | Document metadata + analysis live in on-device storage; page images are copied into the app's document directory. |
| **RAG chatbot** | Ask questions; the backend retrieves the most relevant passages (vector search) and answers with citations. |
| **Knowledge graph** | Entities (people, organizations, amounts, dates) extracted from your documents, linked by how they relate. |

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

## Getting started

### 1. Backend

```bash
cd server
cp .env.example .env       # then fill in AI_API_KEY (and AI_BASE_URL for kit.ai)
npm install
npm run dev                # starts on http://localhost:3001
```

`.env` keys:

- `AI_API_KEY` — your OpenAI / ChatGPT / kit.ai key.
- `AI_BASE_URL` — leave blank for OpenAI; set to your gateway's OpenAI-compatible
  URL (e.g. `https://api.kit.ai/v1`) to use kit.ai.
- `AI_MODEL` — chat/vision model (must support images for scanning, e.g. `gpt-4o`).
- `AI_EMBED_MODEL` — embedding model for retrieval (e.g. `text-embedding-3-small`).

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
