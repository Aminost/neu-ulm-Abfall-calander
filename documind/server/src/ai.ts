// Provider-flexible AI layer. Uses the OpenAI SDK, which speaks the
// OpenAI-compatible protocol — so it works against OpenAI/ChatGPT directly or
// any compatible gateway (e.g. a kit.ai endpoint) by setting AI_BASE_URL.
//
// One vision call does OCR + classification + extraction + a small knowledge
// graph (the "single-pass" approach). Embeddings power retrieval for chat.

import OpenAI from "openai";
import type {
  ChatCompletionContentPart,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";

export const MODEL = process.env.AI_MODEL || "openai/azure.gpt-4.1";
// Empty string disables embeddings; the server falls back to keyword retrieval.
export const EMBED_MODEL =
  process.env.AI_EMBED_MODEL === undefined
    ? "text-embedding-3-small"
    : process.env.AI_EMBED_MODEL;
export const EMBEDDINGS_ENABLED = EMBED_MODEL.trim().length > 0;

// Use a placeholder when the key is missing so the client constructs and the
// server can still boot (health, document listing, keyword search). Real AI
// calls check for the key and fail with a clear message.
const client = new OpenAI({
  apiKey: process.env.AI_API_KEY || "MISSING_KEY",
  baseURL: process.env.AI_BASE_URL || undefined,
});

function ensureKey(): void {
  if (!process.env.AI_API_KEY) {
    throw new Error("AI_API_KEY is not set on the server. Add it to server/.env and restart.");
  }
}

// ── Domain types (kept in sync with the app's src/lib/types.ts) ──────────────
export type HighlightType = "deadline" | "payment" | "critical" | "action";
export type Severity = "low" | "medium" | "high";

export interface Highlight {
  id: string;
  type: HighlightType;
  text: string;
  date?: string;
  amount?: string;
  severity: Severity;
}
export interface Entity {
  name: string;
  type: string;
}
export interface Relation {
  from: string;
  to: string;
  label: string;
}
export interface DocAnalysis {
  title: string;
  category: string;
  summary: string;
  language: string;
  fullText: string;
  highlights: Highlight[];
  entities: Entity[];
  relations: Relation[];
}

const CATEGORIES = [
  "Finance",
  "Legal",
  "Medical",
  "Insurance",
  "Government",
  "Utilities",
  "Work",
  "Education",
  "Personal",
  "Other",
];

const ANALYSIS_SYSTEM = `You are DocuMind, a meticulous document-understanding engine.
You receive a document (as an image, PDF, or plain text). In ONE pass you must:
1. Transcribe ALL readable text faithfully (OCR), preserving line breaks where meaningful.
2. Classify the document into exactly one category from this list: ${CATEGORIES.join(", ")}.
3. Write a concise 1-2 sentence summary.
4. Detect the primary language (English name, e.g. "German", "English").
5. Identify actionable highlights:
   - "deadline": a date by which something is due (resolve to an absolute YYYY-MM-DD when possible).
   - "payment": an amount owed or to be paid (include the amount with currency symbol).
   - "critical": a serious problem, warning, penalty, legal threat, or anything requiring urgent attention.
   - "action": a required action that is not itself a payment or deadline.
   Assign each a severity: "high", "medium", or "low".
6. Extract a small knowledge graph: entities (name + type such as person, organization, invoice, account, date, amount) and relations (from, to, label) describing how they connect.

Respond with STRICT JSON only (no markdown, no commentary) matching:
{
  "title": string,
  "category": string,
  "summary": string,
  "language": string,
  "fullText": string,
  "highlights": [{ "type": "deadline"|"payment"|"critical"|"action", "text": string, "date"?: "YYYY-MM-DD", "amount"?: string, "severity": "high"|"medium"|"low" }],
  "entities": [{ "name": string, "type": string }],
  "relations": [{ "from": string, "to": string, "label": string }]
}
Use the word JSON only as data. If a field has no data, return an empty string or empty array. Today's date is ${new Date().toISOString().slice(0, 10)}.`;

export interface AnalyzeInput {
  imageBase64?: string;
  /** Multiple page images — analyzed together as one document. */
  imagesBase64?: string[];
  mimeType?: string;
  text?: string;
}

function userContent(input: AnalyzeInput): ChatCompletionContentPart[] {
  const instruction = {
    type: "text" as const,
    text: "Analyze this document (all pages together) and return the JSON described.",
  };
  if (input.text) {
    return [
      { type: "text" as const, text: "Document text follows:\n\n" + input.text },
      instruction,
    ];
  }

  const mime = input.mimeType || "image/jpeg";
  const images =
    input.imagesBase64 && input.imagesBase64.length > 0
      ? input.imagesBase64
      : input.imageBase64
        ? [input.imageBase64]
        : [];

  if (mime === "application/pdf" && images.length > 0) {
    // Chat Completions file input (supported by gpt-4o / gpt-4.1 family).
    return [
      {
        type: "file" as any,
        file: { filename: "document.pdf", file_data: `data:${mime};base64,${images[0]}` },
      } as any,
      instruction,
    ];
  }

  const parts: ChatCompletionContentPart[] = images.map((b64) => ({
    type: "image_url" as const,
    image_url: { url: `data:${mime};base64,${b64}` },
  }));
  return [...parts, instruction];
}

function extractJson(raw: string): any {
  // Be forgiving: strip code fences and grab the outermost JSON object.
  const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Model did not return JSON.");
  return JSON.parse(cleaned.slice(start, end + 1));
}

/**
 * Normalize a model-provided date to ISO (YYYY-MM-DD). Accepts the ISO form as
 * well as the common European/German formats real documents use
 * (DD.MM.YYYY, DD/MM/YYYY, DD-MM-YYYY) and YYYY/MM/DD. Returns undefined if it
 * can't confidently parse — so a bad string never becomes a wrong reminder.
 */
export function toIsoDate(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  if (!s) return undefined;

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return s;

  // DD.MM.YYYY / DD/MM/YYYY / DD-MM-YYYY (European day-first)
  let m = s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/);
  if (m) {
    const day = +m[1];
    const mon = +m[2];
    if (day >= 1 && day <= 31 && mon >= 1 && mon <= 12) {
      return `${m[3]}-${String(mon).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }
  // YYYY/MM/DD or YYYY.MM.DD
  m = s.match(/^(\d{4})[.\/](\d{1,2})[.\/](\d{1,2})$/);
  if (m) {
    const mon = +m[2];
    const day = +m[3];
    if (day >= 1 && day <= 31 && mon >= 1 && mon <= 12) {
      return `${m[1]}-${String(mon).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }
  return undefined;
}

let highlightCounter = 0;
function normalize(parsed: any): DocAnalysis {
  const arr = (v: any): any[] => (Array.isArray(v) ? v : []);
  const validTypes: HighlightType[] = ["deadline", "payment", "critical", "action"];
  const validSev: Severity[] = ["high", "medium", "low"];

  const highlights: Highlight[] = arr(parsed.highlights)
    .filter((h) => h && validTypes.includes(h.type))
    .map((h) => ({
      id: `h${Date.now().toString(36)}${highlightCounter++}`,
      type: h.type,
      text: String(h.text ?? "").trim(),
      date: toIsoDate(h.date),
      amount: h.amount ? String(h.amount) : undefined,
      severity: validSev.includes(h.severity) ? h.severity : "medium",
    }))
    .filter((h) => h.text);

  const category = CATEGORIES.includes(parsed.category) ? parsed.category : "Other";

  return {
    title: String(parsed.title ?? "").trim() || "Untitled document",
    category,
    summary: String(parsed.summary ?? "").trim(),
    language: String(parsed.language ?? "").trim(),
    fullText: String(parsed.fullText ?? "").trim(),
    highlights,
    entities: arr(parsed.entities)
      .filter((e) => e && e.name)
      .map((e) => ({ name: String(e.name).trim(), type: String(e.type ?? "thing").trim() })),
    relations: arr(parsed.relations)
      .filter((r) => r && r.from && r.to)
      .map((r) => ({ from: String(r.from).trim(), to: String(r.to).trim(), label: String(r.label ?? "related").trim() })),
  };
}

/**
 * Extract text from a (digital) PDF so we can analyze it as text — more
 * reliable across OpenAI-compatible gateways than sending the PDF as a vision
 * file. Returns "" for image-only/scanned PDFs (caller falls back to vision).
 */
export async function pdfToText(base64: string): Promise<string> {
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(Buffer.from(base64, "base64")));
    const { text } = await extractText(pdf, { mergePages: true });
    return (Array.isArray(text) ? text.join("\n") : text).trim();
  } catch {
    return "";
  }
}

export async function analyzeDocument(input: AnalyzeInput): Promise<DocAnalysis> {
  ensureKey();

  // For PDFs, prefer extracted text (works on every gateway); fall back to the
  // vision file path when the PDF has no embedded text (i.e. it's a scan).
  if (input.mimeType === "application/pdf") {
    const b64 = input.imageBase64 ?? input.imagesBase64?.[0];
    if (b64) {
      const text = await pdfToText(b64);
      if (text.length > 40) return analyzeDocument({ text });
    }
  }

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: ANALYSIS_SYSTEM },
    { role: "user", content: userContent(input) },
  ];

  let raw: string;
  try {
    const res = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.1,
      max_tokens: 4096,
      response_format: { type: "json_object" },
      messages,
    });
    raw = res.choices[0]?.message?.content ?? "";
  } catch {
    // Some OpenAI-compatible gateways reject response_format — retry without it
    // (extractJson tolerates prose/markdown around the JSON).
    const res = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.1,
      max_tokens: 4096,
      messages,
    });
    raw = res.choices[0]?.message?.content ?? "";
  }
  return normalize(extractJson(raw));
}

/**
 * Embed texts. Returns null when embeddings are disabled or the provider
 * rejects the request — callers then fall back to keyword retrieval so RAG
 * keeps working on chat-only gateways.
 */
export async function embedTexts(texts: string[]): Promise<number[][] | null> {
  if (!EMBEDDINGS_ENABLED || texts.length === 0) return null;
  try {
    const res = await client.embeddings.create({ model: EMBED_MODEL, input: texts });
    return res.data.map((d) => d.embedding as number[]);
  } catch (err) {
    console.warn(
      `Embeddings unavailable (${err instanceof Error ? err.message : err}); falling back to keyword retrieval.`,
    );
    return null;
  }
}

const CHAT_SYSTEM = `You are DocuMind's assistant — a smart companion that helps the user manage their documents, deadlines, payments and bureaucracy.
Answer using the provided knowledge base: a FACTS overview (structured deadlines, payments, critical items and entities across all documents — the user's knowledge graph) and EXCERPTS (relevant passages from specific documents).
- Be specific and detailed. Quote amounts, dates and names exactly as written.
- Prefer the FACTS overview for questions about what's due, what is owed, or which documents are involved; use EXCERPTS for details and to ground your answer.
- Always attribute information to the source document by its title.
- If the knowledge base doesn't contain the answer, say so plainly — never invent facts.
- When relevant, proactively surface upcoming deadlines or required payments.`;

export async function answerQuestion(
  question: string,
  contexts: { title: string; text: string }[],
  history: { role: "user" | "assistant"; content: string }[],
  facts = "",
): Promise<string> {
  ensureKey();
  const excerpts =
    contexts.length > 0
      ? contexts.map((c, i) => `[${i + 1}] ${c.title}\n${c.text}`).join("\n\n---\n\n")
      : "(no matching excerpts)";
  const factsBlock = facts.trim() ? facts : "(no documents digitized yet)";

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: CHAT_SYSTEM },
    ...history.slice(-6),
    {
      role: "user",
      content: `FACTS overview (knowledge graph):\n${factsBlock}\n\nEXCERPTS:\n${excerpts}\n\nQuestion: ${question}`,
    },
  ];

  const res = await client.chat.completions.create({
    model: MODEL,
    temperature: 0.2,
    max_tokens: 800,
    messages,
  });
  return res.choices[0]?.message?.content?.trim() ?? "I couldn't generate an answer.";
}
