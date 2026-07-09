// Thin typed wrapper around the DocuMind backend. The backend holds the AI
// provider key (OpenAI / ChatGPT / kit.ai-compatible) and does OCR,
// classification, extraction and RAG. The app never sees the key.

import { getSettings } from "../lib/storage";
import type { ChatMessage, Citation, DocAnalysis } from "../lib/types";

async function baseUrl(): Promise<string> {
  const { apiUrl } = await getSettings();
  return apiUrl.replace(/\/$/, "");
}

async function request<T>(path: string, body: unknown): Promise<T> {
  const url = (await baseUrl()) + path;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error(
      `Cannot reach the backend at ${url}. Is the server running and the API URL correct in Settings?`,
    );
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Server error ${res.status}: ${text || res.statusText}`);
  }
  return (await res.json()) as T;
}

/**
 * Single-pass OCR + understanding. Sends the page image (base64) to the
 * vision model and gets back transcribed text, a topic, a summary, flagged
 * highlights (deadlines, payments, critical issues, actions) and a small
 * knowledge graph of entities + relations.
 */
export async function analyzeImage(
  imageBase64: string,
  mimeType = "image/jpeg",
): Promise<DocAnalysis> {
  const { analysis } = await request<{ analysis: DocAnalysis }>("/api/analyze", {
    imageBase64,
    mimeType,
  });
  return analysis;
}

/** Analyze a multi-page document — every page image is sent in one vision call. */
export async function analyzeImages(
  imagesBase64: string[],
  mimeType = "image/jpeg",
): Promise<DocAnalysis> {
  const { analysis } = await request<{ analysis: DocAnalysis }>("/api/analyze", {
    imagesBase64,
    mimeType,
  });
  return analysis;
}

/** Analyze raw text (used for PDF/text imports where we already have text). */
export async function analyzeText(text: string): Promise<DocAnalysis> {
  const { analysis } = await request<{ analysis: DocAnalysis }>("/api/analyze", {
    text,
  });
  return analysis;
}

/**
 * Store a document on the backend: its analysis (for the knowledge graph + chat)
 * and text (for retrieval). Also makes it available to other devices via restore.
 */
export async function upsertDocument(doc: {
  id: string;
  title: string;
  createdAt: number;
  analysis: DocAnalysis;
}): Promise<void> {
  await request("/api/documents", {
    docId: doc.id,
    title: doc.title,
    createdAt: doc.createdAt,
    analysis: doc.analysis,
  });
}

export async function deleteServerDocument(docId: string): Promise<void> {
  await request("/api/documents/delete", { docId });
}

/** Fetch all documents stored on the backend (for restoring on a new device). */
export async function fetchServerDocuments(): Promise<
  { docId: string; title: string; createdAt: number; analysis: DocAnalysis }[]
> {
  const url = (await baseUrl()) + "/api/documents";
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Server error ${res.status}`);
  const data = (await res.json()) as {
    documents: { docId: string; title: string; createdAt: number; analysis: DocAnalysis }[];
  };
  return data.documents;
}

export async function askQuestion(
  question: string,
  history: ChatMessage[],
): Promise<{ answer: string; citations: Citation[] }> {
  return request<{ answer: string; citations: Citation[] }>("/api/chat", {
    question,
    history: history
      .filter((m) => !m.pending)
      .map((m) => ({ role: m.role, content: m.content })),
  });
}

export async function checkHealth(): Promise<{ ok: boolean; model?: string }> {
  const url = (await baseUrl()) + "/api/health";
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
  return res.json();
}
