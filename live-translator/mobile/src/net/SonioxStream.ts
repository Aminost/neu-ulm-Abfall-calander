import type { SttToken } from "../engine/logic";
import type { SttToken as Credentials } from "./api";

/**
 * Streaming speech recognition over the Soniox real-time WebSocket API:
 * multilingual transcription with per-word language identification, speaker
 * diarization and endpoint detection (an "<end>" token when the speaker pauses).
 */
export interface SonioxOptions {
  getCredentials: () => Promise<Credentials>;
  languageHints: string[];
  onTokens: (tokens: SttToken[]) => void;
  onStatus: (status: "connecting" | "open" | "reconnecting" | "closed") => void;
  onError: (message: string) => void;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const LOOKUP = new Uint8Array(256);
for (let i = 0; i < B64.length; i++) LOOKUP[B64.charCodeAt(i)] = i;

export function base64ToBytes(b64: string): Uint8Array {
  let len = (b64.length * 3) / 4;
  if (b64.endsWith("==")) len -= 2;
  else if (b64.endsWith("=")) len -= 1;
  const out = new Uint8Array(len);
  let p = 0;
  for (let i = 0; i < b64.length; i += 4) {
    const a = LOOKUP[b64.charCodeAt(i)];
    const b = LOOKUP[b64.charCodeAt(i + 1)];
    const c = LOOKUP[b64.charCodeAt(i + 2)];
    const d = LOOKUP[b64.charCodeAt(i + 3)];
    out[p++] = (a << 2) | (b >> 4);
    if (p < len) out[p++] = ((b & 15) << 4) | (c >> 2);
    if (p < len) out[p++] = ((c & 3) << 6) | d;
  }
  return out;
}

export class SonioxStream {
  private ws: WebSocket | null = null;
  private queue: Uint8Array[] = [];
  private open = false;
  private stopped = false;
  private retries = 0;
  private lastAudioAt = 0;
  private keepAlive: ReturnType<typeof setInterval> | null = null;
  private creds: Credentials | null = null;

  constructor(private o: SonioxOptions) {}

  async start() {
    this.stopped = false;
    await this.connect();
    this.keepAlive = setInterval(() => {
      // While the mic is muted (the app is speaking) no audio flows; keep the session alive.
      if (this.open && Date.now() - this.lastAudioAt > 4000) this.ws?.send(JSON.stringify({ type: "keepalive" }));
    }, 4000);
  }

  private async connect() {
    this.o.onStatus(this.retries ? "reconnecting" : "connecting");
    const expired = this.creds?.expiresAt && Date.parse(this.creds.expiresAt) - Date.now() < 60_000;
    if (!this.creds || expired || this.retries > 0) this.creds = await this.o.getCredentials();
    const { wsUrl, apiKey, model } = this.creds;
    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";
    this.ws = ws;

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          api_key: apiKey,
          model,
          audio_format: "pcm_s16le",
          sample_rate: 16000,
          num_channels: 1,
          language_hints: this.o.languageHints,
          enable_language_identification: true,
          enable_speaker_diarization: true,
          enable_endpoint_detection: true,
        }),
      );
      this.open = true;
      this.retries = 0;
      this.o.onStatus("open");
      for (const chunk of this.queue.splice(0)) ws.send(chunk);
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data !== "string") return;
      let msg: { tokens?: SttToken[]; error_code?: number; error_message?: string; finished?: boolean };
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.error_code) {
        this.o.onError(`Speech recognition: ${msg.error_message ?? msg.error_code}`);
        return;
      }
      if (msg.tokens?.length) this.o.onTokens(msg.tokens);
    };
    ws.onerror = () => {
      /* onclose handles reconnects */
    };
    ws.onclose = () => {
      this.open = false;
      if (this.stopped) {
        this.o.onStatus("closed");
        return;
      }
      // Network blips, app switching, token expiry: reconnect with backoff.
      this.retries++;
      const delay = Math.min(8000, 300 * 2 ** this.retries);
      setTimeout(() => {
        if (!this.stopped) this.connect().catch((e) => this.o.onError(String(e?.message ?? e)));
      }, delay);
    };
  }

  sendAudio(b64: string) {
    const bytes = base64ToBytes(b64);
    this.lastAudioAt = Date.now();
    if (this.open && this.ws) this.ws.send(bytes);
    else if (this.queue.length < 30) this.queue.push(bytes); // keep up to ~3 s while connecting
  }

  /** Ask the recognizer to finalize everything heard so far (ends with a "<fin>" token). */
  finalize() {
    if (this.open) this.ws?.send(JSON.stringify({ type: "finalize" }));
  }

  stop() {
    this.stopped = true;
    if (this.keepAlive) clearInterval(this.keepAlive);
    this.keepAlive = null;
    this.queue = [];
    try {
      if (this.open) this.ws?.send(""); // empty frame = end of audio
    } catch {}
    setTimeout(() => this.ws?.close(), 500);
  }
}
