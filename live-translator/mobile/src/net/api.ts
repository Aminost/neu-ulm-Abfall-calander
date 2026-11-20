import type { Settings } from "../types";

export interface SttToken {
  apiKey: string;
  expiresAt?: string;
  model: string;
  wsUrl: string;
}

export interface TranslateResponse {
  sourceLanguage: string;
  translations: { language: string; text: string }[];
  ms: number;
}

const base = (s: Settings) => s.serverUrl.replace(/\/+$/, "");

async function post<T>(s: Settings, path: string, body: unknown, timeoutMs = 15000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${base(s)}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-app-token": s.appToken },
      body: JSON.stringify(body ?? {}),
      signal: ctrl.signal,
    });
    if (!r.ok) {
      const msg = await r.json().then((j) => j.error).catch(() => r.statusText);
      throw new Error(`${r.status} ${msg}`);
    }
    return (await r.json()) as T;
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new Error("Server did not answer in time");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  sttToken: (s: Settings) => post<SttToken>(s, "/api/stt-token", {}),
  translate: (
    s: Settings,
    body: {
      text: string;
      sttLanguage: string | null;
      languages: string[];
      targets?: string[];
      context?: { language: string; text: string }[];
    },
  ) => post<TranslateResponse>(s, "/api/translate", body),
  createRoom: (s: Settings) => post<{ code: string }>(s, "/api/rooms", {}),
  roomUrl: (s: Settings, code: string, name: string, lang: string) => {
    const ws = base(s).replace(/^http/, "ws");
    const q = new URLSearchParams({ code, name, lang, token: s.appToken });
    return `${ws}/room?${q.toString()}`;
  },
};
