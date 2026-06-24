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

const client = new OpenAI({
  apiKey: process.env.AI_API_KEY,
  baseURL: process.env.AI_BASE_URL || undefined,
});

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
  mimeType?: string;
  text?: string;
}

function userContent(input: AnalyzeInput): ChatCompletionContentPart[] {
  const instruction = { type: "text" as const, text: "Analyze this document and return the JSON described." };
  if (input.text) {
    return [
      { type: "text" as const, text: "Document text follows:\n\n" + input.text },
      instruction,
    ];
  }
  const mime = input.mimeType || "image/jpeg";
  const dataUri = `data:${mime};base64,${input.imageBase64}`;
  if (mime === "application/pdf") {
    // Chat Completions file input (supported by gpt-4o family).
    return [
      { type: "file" as any, file: { filename: "document.pdf", file_data: dataUri } } as any,
      instruction,
    ];
  }
  return [
    { type: "image_url" as const, image_url: { url: dataUri } },
    instruction,
  ];
}

function extractJson(raw: string): any {
  // Be forgiving: strip code fences and grab the outermost JSON object.
  const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Model did not return JSON.");
  return JSON.parse(cleaned.slice(start, end + 1));
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
      date: typeof h.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(h.date) ? h.date : undefined,
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

export async function analyzeDocument(input: AnalyzeInput): Promise<DocAnalysis> {
  const res = await client.chat.completions.create({
    model: MODEL,
    temperature: 0.1,
    max_tokens: 4096,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: ANALYSIS_SYSTEM },
      { role: "user", content: userContent(input) },
    ],
  });
  const raw = res.choices[0]?.message?.content ?? "";
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

const CHAT_SYSTEM = `You are DocuMind's assistant. Answer the user's question using ONLY the provided document excerpts.
- Be concise and specific. Quote amounts, dates and names exactly as written.
- If the excerpts don't contain the answer, say so plainly — do not invent facts.
- When you use information from an excerpt, you may refer to its document by title.`;

export async function answerQuestion(
  question: string,
  contexts: { title: string; text: string }[],
  history: { role: "user" | "assistant"; content: string }[],
): Promise<string> {
  const contextBlock =
    contexts.length > 0
      ? contexts.map((c, i) => `[${i + 1}] ${c.title}\n${c.text}`).join("\n\n---\n\n")
      : "(no documents have been digitized yet)";

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: CHAT_SYSTEM },
    ...history.slice(-6),
    {
      role: "user",
      content: `Document excerpts:\n\n${contextBlock}\n\nQuestion: ${question}`,
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
