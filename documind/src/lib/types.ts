// Shared domain types for DocuMind. Mirrors the JSON shape returned by the
// backend's /api/analyze endpoint so the same types describe wire + storage.

export type HighlightType = "deadline" | "payment" | "critical" | "action";

export type Severity = "low" | "medium" | "high";

export interface Highlight {
  id: string;
  type: HighlightType;
  /** Short human-readable description of the flagged item. */
  text: string;
  /** ISO date (YYYY-MM-DD) when the model could resolve one. */
  date?: string;
  /** Monetary amount with currency, e.g. "€149.90". */
  amount?: string;
  severity: Severity;
}

export interface Entity {
  name: string;
  /** e.g. "person", "organization", "invoice", "account", "date". */
  type: string;
}

export interface Relation {
  from: string;
  to: string;
  label: string;
}

/** The full analysis the model returns for a single document. */
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

export type DocStatus = "processing" | "ready" | "error";

export interface DocumentRecord {
  id: string;
  createdAt: number;
  /** Local file:// URI of the first page image (thumbnail), when present. */
  imageUri?: string;
  /** Local file:// URI of the generated/imported PDF, when present. */
  pdfUri?: string;
  /** Number of scanned pages. */
  pageCount?: number;
  fileName?: string;
  status: DocStatus;
  error?: string;
  analysis: DocAnalysis;
}

export interface Citation {
  docId: string;
  title: string;
  snippet: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  pending?: boolean;
}

export const CATEGORIES = [
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
] as const;
