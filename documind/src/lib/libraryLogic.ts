// Pure logic for the Library: category list + full-text/category filtering.
// Framework-agnostic so it can be unit-tested directly.

import type { DocumentRecord } from "./types";

export function documentCategories(docs: DocumentRecord[]): string[] {
  return [...new Set(docs.map((d) => d.analysis.category))].sort();
}

/** Filter documents by an optional category and a free-text query that matches
 *  title, summary, category, highlight texts and entity names. */
export function filterDocuments(
  docs: DocumentRecord[],
  query: string,
  cat: string | null,
): DocumentRecord[] {
  const q = query.trim().toLowerCase();
  return docs.filter((d) => {
    if (cat && d.analysis.category !== cat) return false;
    if (!q) return true;
    const hay = [
      d.analysis.title,
      d.analysis.summary,
      d.analysis.category,
      ...d.analysis.highlights.map((h) => h.text),
      ...d.analysis.highlights.map((h) => h.amount ?? ""),
      ...d.analysis.entities.map((e) => e.name),
    ]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
}
