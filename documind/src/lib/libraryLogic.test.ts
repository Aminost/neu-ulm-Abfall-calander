import assert from "node:assert/strict";
import { test } from "node:test";
import { documentCategories, filterDocuments } from "./libraryLogic";
import type { DocumentRecord } from "./types";

function doc(id: string, category: string, over: Partial<DocumentRecord["analysis"]> = {}): DocumentRecord {
  return {
    id,
    createdAt: 0,
    status: "ready",
    analysis: {
      title: `Doc ${id}`,
      category,
      summary: "",
      language: "German",
      fullText: "",
      highlights: [],
      entities: [],
      relations: [],
      ...over,
    },
  };
}

const docs: DocumentRecord[] = [
  doc("a", "Utilities", {
    title: "Stadtwerke Rechnung",
    highlights: [{ id: "1", type: "payment", text: "Electricity", amount: "149,90 EUR", severity: "high" }],
    entities: [{ name: "Stadtwerke Neu-Ulm", type: "organization" }],
  }),
  doc("b", "Insurance", { title: "AOK Brief", entities: [{ name: "AOK", type: "organization" }] }),
  doc("c", "Utilities", { title: "Gasrechnung" }),
];

test("documentCategories returns unique sorted categories", () => {
  assert.deepEqual(documentCategories(docs), ["Insurance", "Utilities"]);
});

test("filterDocuments matches title, entity, and amount", () => {
  assert.deepEqual(filterDocuments(docs, "stadtwerke", null).map((d) => d.id), ["a"]);
  assert.deepEqual(filterDocuments(docs, "aok", null).map((d) => d.id), ["b"]);
  assert.deepEqual(filterDocuments(docs, "149,90", null).map((d) => d.id), ["a"]);
});

test("filterDocuments respects category and empty query", () => {
  assert.deepEqual(filterDocuments(docs, "", "Utilities").map((d) => d.id), ["a", "c"]);
  assert.deepEqual(filterDocuments(docs, "", null).length, 3);
  assert.deepEqual(filterDocuments(docs, "gas", "Insurance"), []); // category excludes it
});
