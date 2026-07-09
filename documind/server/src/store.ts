// Persistent store for retrieval-augmented chat AND cross-device access.
//
// Two JSON files:
//   - vectorstore.json : text chunks (+ embeddings when available) for retrieval
//   - documents.json   : full document metadata + analysis, so a new device can
//                        restore the library and so chat can use structured
//                        facts (deadlines, payments, entities) — the knowledge
//                        graph — not just raw text.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DocAnalysis } from "./ai.js";

const here = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(here, "..", "data");
const STORE_PATH = join(DATA_DIR, "vectorstore.json");
const DOCS_PATH = join(DATA_DIR, "documents.json");

export interface Chunk {
  docId: string;
  title: string;
  text: string;
  embedding: number[] | null;
}

export interface StoredDoc {
  docId: string;
  title: string;
  createdAt: number;
  analysis: DocAnalysis;
}

let chunks: Chunk[] = loadJson(STORE_PATH, []);
let docs: StoredDoc[] = loadJson(DOCS_PATH, []);

function loadJson<T>(path: string, fallback: T): T {
  try {
    if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    /* corrupt — start fresh */
  }
  return fallback;
}

function persist(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(STORE_PATH, JSON.stringify(chunks));
  writeFileSync(DOCS_PATH, JSON.stringify(docs));
}

// ── Documents ────────────────────────────────────────────────────────────────

export function upsertDoc(doc: StoredDoc): void {
  docs = docs.filter((d) => d.docId !== doc.docId);
  docs.push(doc);
  persist();
}

export function listDocs(): StoredDoc[] {
  return [...docs].sort((a, b) => b.createdAt - a.createdAt);
}

export function removeDoc(docId: string): void {
  docs = docs.filter((d) => d.docId !== docId);
  chunks = chunks.filter((c) => c.docId !== docId);
  persist();
}

/**
 * A compact "facts sheet" across the whole library: each document's deadlines,
 * payments and critical items, plus key entities. Fed to the chat model so it
 * can answer questions like "what do I owe / what's due" precisely, with the
 * document title as the source.
 */
export function factsSheet(): string {
  if (docs.length === 0) return "";
  const lines: string[] = [];
  for (const d of docs) {
    const flags = d.analysis.highlights
      .filter((h) => ["deadline", "payment", "critical", "action"].includes(h.type))
      .map((h) => {
        const bits = [h.type.toUpperCase(), h.text];
        if (h.date) bits.push(`(due ${h.date})`);
        if (h.amount) bits.push(`(${h.amount})`);
        return "  - " + bits.join(" ");
      });
    const ents = d.analysis.entities.slice(0, 8).map((e) => `${e.name} [${e.type}]`);
    if (flags.length === 0 && ents.length === 0) continue;
    lines.push(`• ${d.analysis.title || "Untitled"} (${d.analysis.category}):`);
    if (flags.length) lines.push(...flags);
    if (ents.length) lines.push(`  entities: ${ents.join(", ")}`);
  }
  return lines.join("\n").slice(0, 6000);
}

// ── Chunks / retrieval ───────────────────────────────────────────────────────

export function chunkText(text: string, maxLen = 900, overlap = 150): string[] {
  const clean = text.replace(/\s+\n/g, "\n").trim();
  if (clean.length <= maxLen) return clean ? [clean] : [];
  const out: string[] = [];
  let i = 0;
  while (i < clean.length) {
    let end = Math.min(i + maxLen, clean.length);
    const slice = clean.slice(i, end);
    const breakAt = Math.max(slice.lastIndexOf("\n"), slice.lastIndexOf(". "));
    if (end < clean.length && breakAt > maxLen * 0.5) end = i + breakAt + 1;
    out.push(clean.slice(i, end).trim());
    i = end - overlap;
    if (i < 0) i = 0;
  }
  return out.filter(Boolean);
}

export function setChunks(
  docId: string,
  title: string,
  pieces: { text: string; embedding: number[] | null }[],
): void {
  chunks = chunks.filter((c) => c.docId !== docId);
  for (const p of pieces) chunks.push({ docId, title, text: p.text, embedding: p.embedding });
  persist();
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

function lexicalScore(queryTokens: Set<string>, text: string): number {
  if (queryTokens.size === 0) return 0;
  const textTokens = new Set(tokenize(text));
  let hits = 0;
  for (const t of queryTokens) if (textTokens.has(t)) hits++;
  return hits / queryTokens.size;
}

export interface SearchHit extends Chunk {
  score: number;
}

export function search(
  queryText: string,
  queryEmbedding: number[] | null,
  k = 5,
): SearchHit[] {
  const queryTokens = new Set(tokenize(queryText));
  return chunks
    .map((c) => {
      const score =
        queryEmbedding && c.embedding
          ? cosine(queryEmbedding, c.embedding)
          : lexicalScore(queryTokens, c.text);
      return { ...c, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
