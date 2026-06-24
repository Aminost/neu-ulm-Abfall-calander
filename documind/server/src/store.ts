// A tiny JSON-persisted store for retrieval-augmented chat. Each document's
// text is split into overlapping chunks. When the AI gateway provides
// embeddings, retrieval uses cosine similarity; otherwise it falls back to a
// keyword-overlap score, so chat works even on a chat-only gateway.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(here, "..", "data");
const STORE_PATH = join(DATA_DIR, "vectorstore.json");

export interface Chunk {
  docId: string;
  title: string;
  text: string;
  embedding: number[] | null;
}

let chunks: Chunk[] = load();

function load(): Chunk[] {
  try {
    if (existsSync(STORE_PATH)) {
      return JSON.parse(readFileSync(STORE_PATH, "utf8")) as Chunk[];
    }
  } catch {
    /* corrupt store — start fresh */
  }
  return [];
}

function persist(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(STORE_PATH, JSON.stringify(chunks));
}

/** Split text into ~maxLen-char chunks with a little overlap, on sentence-ish boundaries. */
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

export function removeDocument(docId: string): void {
  chunks = chunks.filter((c) => c.docId !== docId);
  persist();
}

export function addDocument(
  docId: string,
  title: string,
  pieces: { text: string; embedding: number[] | null }[],
): void {
  removeDocument(docId); // replace any prior version
  for (const p of pieces) {
    chunks.push({ docId, title, text: p.text, embedding: p.embedding });
  }
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

/** Keyword-overlap score in [0,1] — used when embeddings aren't available. */
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

/**
 * Retrieve the top-k chunks. Uses cosine similarity for chunks that have an
 * embedding (when a query embedding is supplied), and keyword overlap otherwise.
 */
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

export function count(): number {
  return chunks.length;
}
