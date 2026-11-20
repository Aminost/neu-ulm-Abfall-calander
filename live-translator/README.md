# Live Translator

A live, two-way (or more) conversation interpreter for **Android and iOS**.
Talk normally. The app hears who is speaking, works out the language, translates it for everyone else, and reads it aloud on each listener's own headset or speaker.

```
 mic (phone / Bluetooth headset)            ┌────────── server (Node) ──────────┐
   │ 16 kHz PCM, 100 ms chunks              │ /api/stt-token  short-lived key   │
   ▼                                        │ /api/translate  Claude            │
 Soniox real-time STT ◄── direct WebSocket  │ /room           multi-phone relay │
   │ words + language + speaker + <end>     └───────────────────────────────────┘
   ▼
 Segmenter ─► who is speaking? ─► translate into every other language ─► play each
 (pause, voice   (language first,      (one call, returns all targets,     translation on the
  or language     then voice, then       with recent context)                listener's output,
  change)         whose mic is live)                                         then hand them the mic
```

## Features

| | |
|---|---|
| 🗣 **Both directions, automatically** | No "my turn / your turn" buttons. Each utterance is detected and translated toward everyone else. |
| 🌍 **Language detection** | Per-word language ID from the recognizer, confirmed by the translation model, which picks one of the conversation's languages. 32 languages in the picker, including Arabic, Turkish, Persian, Ukrainian and others. |
| 👥 **Speaker detection** | Language → person when the languages differ. When two people share a language, diarization (voice) tells them apart, with the active mic as a tie-breaker. The app learns which voice belongs to whom as the talk goes on. |
| 🎧 **Per-person input and output** | In Setup, choose each person's microphone and where they hear their translation: a Bluetooth headset, a Bluetooth speaker, the phone speaker, or wired/USB. |
| ⚙️ **Auto routing** | "Auto" output = the earpiece of the same headset the person talks into, otherwise the phone speaker. **Mic hand-off:** after a translation the app moves the mic to the person who was just addressed, because they answer next. Tap a person's tile to override. |
| 🔇 **No feedback loops** | The mic is muted while a translation plays, so the app never translates itself (can be turned off if everyone wears headphones). OS echo cancellation and noise suppression are on by default. |
| ⚡ **Smooth and fast** | Audio streams straight to the recognizer; an utterance ends at the speaker's natural pause (endpoint detection), or tap **Done ✓**. Translations play strictly in conversation order. Auto-reconnect on network drops. Screen stays awake. |
| 📱 **Multi-phone mode** | Everyone uses their own phone and headset in a room (6-letter code). Each phone transcribes its owner and translates incoming speech into its owner's language. No Bluetooth limits, any number of people and languages. |
| 💬 **Live subtitles** | Original and translation side by side, live partial captions, RTL text for Arabic, Hebrew, Persian and Urdu, and a "subtitles only" mode. |

## What phones can and can't do with Bluetooth (read this)

The routing code goes as far as the operating systems allow. The limits are in Android and iOS, not in this app:

- **One Bluetooth microphone at a time.** Both OSes open one headset (HFP/SCO) mic link at a time. With two headsets on one phone, the app *switches* the mic between them (mic hand-off, or tap a tile). It cannot record both at once. A switch takes about 0.5–1.5 s while the link reconnects.
- **Android:** each translation can go to a different device: headset A, a Bluetooth speaker (A2DP), or the phone speaker. A headset's mic and earpiece always switch together. Two A2DP outputs playing *at the same time* only works on phones with a "dual audio" feature (e.g. Samsung), outside app control.
- **iOS:** Apple has no API to pick between two connected Bluetooth *outputs*. You can choose the phone speaker or a Bluetooth headset (selected through its mic); with two headsets, iOS uses the one whose mic is active.
- **Best setups:**
  1. **One phone, one headset + phone speaker.** You wear the headset and the other person uses the phone's speaker and mic. Works fully on both OSes.
  2. **One phone, two headsets (Android).** Works with mic hand-off. Expect the short switch delay.
  3. **Two phones (Multi-phone tab).** Each person has their own phone and headset. Best quality, no limits.

## Project layout

```
live-translator/
├── server/                    Node + Express + ws
│   └── src/
│       ├── index.ts           API, Soniox key minting, room WebSocket
│       ├── translate.ts       Claude translation + language confirmation (structured JSON)
│       └── rooms.ts           multi-phone relay
└── mobile/                    Expo SDK 58 (React Native 0.88)
    ├── modules/audio-routing/ native module (Kotlin + Swift)
    │   ├── android/…/AudioRoutingModule.kt   AudioRecord + setCommunicationDevice + TTS→MediaPlayer on chosen device
    │   └── ios/AudioRoutingModule.swift      AVAudioEngine + AVAudioSession routing + AVSpeechSynthesizer
    └── src/
        ├── engine/logic.ts            segmentation, speaker detection, routing decisions (unit tested)
        ├── engine/ConversationEngine.ts  the live pipeline
        ├── net/SonioxStream.ts        streaming recognition
        ├── net/RoomClient.ts          multi-phone client
        └── ui/                        Conversation, Setup, Multi-phone screens
```

## Run it

### 1. Server

```bash
cd live-translator/server
cp .env.example .env      # fill in ANTHROPIC_API_KEY, SONIOX_API_KEY, APP_TOKEN
npm install
npm run dev               # http://0.0.0.0:8787
npm test
```

API keys stay on the server. The phone gets a 1-hour Soniox key and calls `/api/translate` with the shared `APP_TOKEN`. For real use, deploy the server behind HTTPS (Fly.io, Render, a VPS…).

`TRANSLATION_MODEL` defaults to `claude-opus-5-5` at low effort. For the lowest latency and cost, try `claude-haiku-5-5`.

### 2. App

The app has a native module, so it needs a **development build**. Expo Go can't run it.

```bash
cd live-translator/mobile
npm install
npx expo run:android          # or: npx expo run:ios   (needs Xcode)
# or build in the cloud:
npx eas build --profile development --platform all
```

Then, in the app: **Setup → Server**, enter the server address and app token. Set each person's name, language, mic and output. Press **Start** on the Conversation tab.

Voices come from the phone's text-to-speech. If a language has no voice, install it: Android: *Settings → Text-to-speech*; iOS: *Settings → Accessibility → Spoken Content → Voices*.

### Checks

```bash
cd mobile && npm run type-check && npm test     # TypeScript + logic tests
cd server && npm run type-check && npm test
```

## Status

- ✅ TypeScript for app and server type-checks; logic and server unit tests pass; the Metro Android bundle builds.
- ⚠️ The Kotlin and Swift native module has **not been compiled or run on a device yet** (no Android SDK or Xcode in the build environment). Expect a first round of fixes on the first `expo run:android` / `run:ios`.
- ⚠️ The Soniox WebSocket fields (`stt-rt-v3`, `enable_language_identification`, `enable_speaker_diarization`, `enable_endpoint_detection`, `<end>` / `<fin>` tokens, temporary-key endpoint) were written from memory of their docs and not checked against them. They all live in `mobile/src/net/SonioxStream.ts` and `server/src/index.ts` (`/api/stt-token`).
