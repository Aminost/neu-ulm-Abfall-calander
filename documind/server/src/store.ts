// A tiny JSON-persisted vector store for retrieval-augmented chat. Each
// document's text is split into overlapping chunks, embedded, and stored.
// Retrieval is exact cosine similarity over the in-memory array — more than
// enough for a personal document library.

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
  embedding: number[];
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
    // try to break on a paragraph or sentence boundary near the end
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

export function addDocument(docId: string, title: string, embedded: { text: string; embedding: number[] }[]): void {
  removeDocument(docId); // replace any prior version
  for (const e of embedded) {
    chunks.push({ docId, title, text: e.text, embedding: e.embedding });
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

export interface SearchHit extends Chunk {
  score: number;
}

export function search(queryEmbedding: number[], k = 5): SearchHit[] {
  return chunks
    .map((c) => ({ ...c, score: cosine(queryEmbedding, c.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

export function count(): number {
  return chunks.length;
}
