import "dotenv/config";
import express from "express";
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { WebSocketServer } from "ws";
import Anthropic from "@anthropic-ai/sdk";
import { Translator, validateRequest } from "./translate.js";
import { Rooms } from "./rooms.js";

const PORT = Number(process.env.PORT || 8787);
const APP_TOKEN = process.env.APP_TOKEN || "";
const SONIOX_MODEL = process.env.SONIOX_MODEL || "stt-rt-v3";

if (!APP_TOKEN || APP_TOKEN === "change-me") {
  console.warn("[warn] APP_TOKEN is not set to a secret value: anyone who finds this server can use your API keys.");
}

function tokenOk(token: unknown): boolean {
  if (!APP_TOKEN) return true;
  if (typeof token !== "string") return false;
  const a = Buffer.from(token);
  const b = Buffer.from(APP_TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

const app = express();
app.use(express.json({ limit: "64kb" }));

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/api", (req, res, next) => {
  if (!tokenOk(req.header("x-app-token"))) return res.status(401).json({ error: "unauthorized" });
  next();
});

/** Short-lived Soniox key so the phone can stream audio straight to Soniox (lowest latency). */
app.post("/api/stt-token", async (_req, res) => {
  try {
    const r = await fetch("https://api.soniox.com/v1/auth/temporary-api-key", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.SONIOX_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ usage_type: "transcribe_websocket", expires_in_seconds: 3600 }),
    });
    if (!r.ok) throw new Error(`soniox ${r.status}: ${await r.text()}`);
    const data = (await r.json()) as { api_key: string; expires_at?: string };
    res.json({
      apiKey: data.api_key,
      expiresAt: data.expires_at,
      model: SONIOX_MODEL,
      wsUrl: "wss://stt-rt.soniox.com/transcribe-websocket",
    });
  } catch (e) {
    console.error("[stt-token]", e);
    res.status(502).json({ error: "could not create speech token" });
  }
});

const translator = new Translator();

app.post("/api/translate", async (req, res) => {
  let body;
  try {
    body = validateRequest(req.body);
  } catch (e) {
    return res.status(400).json({ error: (e as Error).message });
  }
  const started = Date.now();
  try {
    const result = await translator.translate(body);
    res.json({ ...result, ms: Date.now() - started });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return res.status(429).json({ error: "rate limited" });
    if (e instanceof Anthropic.APIError) {
      console.error("[translate] api", e.status, e.message);
      return res.status(502).json({ error: "translation service error" });
    }
    console.error("[translate]", e);
    res.status(500).json({ error: (e as Error).message });
  }
});

const rooms = new Rooms();
app.post("/api/rooms", (_req, res) => res.json({ code: rooms.newCode() }));

const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/room", maxPayload: 64 * 1024 });

wss.on("connection", (socket, req) => {
  const url = new URL(req.url ?? "", "http://localhost");
  const code = (url.searchParams.get("code") || "").toUpperCase();
  const name = url.searchParams.get("name") || "Guest";
  const language = url.searchParams.get("lang") || "en";
  if (!tokenOk(url.searchParams.get("token")) || !/^[A-Z0-9]{6}$/.test(code)) {
    socket.close(4001, "unauthorized");
    return;
  }
  let member;
  try {
    member = rooms.join(code, name, language, socket);
  } catch (e) {
    socket.close(4002, (e as Error).message);
    return;
  }
  socket.send(JSON.stringify({ type: "welcome", id: member.id, code }));
  const alive = setInterval(() => socket.readyState === 1 && socket.ping(), 20000);

  socket.on("message", (raw) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    // Only relay known message types; the speaker's phone sends what it heard.
    if (msg.type === "utterance" && typeof msg.text === "string" && typeof msg.language === "string") {
      rooms.relay(code, member, {
        type: "utterance",
        id: typeof msg.id === "string" ? msg.id : undefined,
        text: msg.text.slice(0, 4000),
        language: msg.language,
      });
    } else if (msg.type === "partial" && typeof msg.text === "string") {
      rooms.relay(code, member, { type: "partial", text: msg.text.slice(0, 1000) });
    }
  });
  socket.on("close", () => {
    clearInterval(alive);
    rooms.leave(code, member.id);
  });
});

server.listen(PORT, () => console.log(`live-translator server on :${PORT}`));
