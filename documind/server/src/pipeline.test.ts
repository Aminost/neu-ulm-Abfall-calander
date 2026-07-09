// End-to-end pipeline tests with a MOCKED OpenAI-compatible endpoint.
//
// This exercises the whole backend flow without a real API key: OCR/analysis
// JSON parsing + normalization, structured-fact storage (the knowledge graph),
// text chunking, keyword retrieval, and knowledge-graph-aware answering with
// citations. Only the model's actual wording is stubbed — everything the app
// depends on around it is verified.
//
// Run with:  npm test   (node --import tsx --test src/pipeline.test.ts)

import assert from "node:assert/strict";
import http from "node:http";
import { rmSync } from "node:fs";
import { after, test } from "node:test";

// ── Start a mock model server, then point the client at it (env before import) ──
const PORT = 3987;

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const payload = JSON.parse(body || "{}");
    const system = JSON.stringify(payload.messages?.[0] ?? {});
    res.setHeader("content-type", "application/json");

    if (req.url?.endsWith("/chat/completions")) {
      let content: string;
      if (system.includes("meticulous document-understanding")) {
        // analysis request → return structured document JSON.
        // "BADCAT" in the input exercises the invalid-category fallback.
        content = JSON.stringify({
          title: "Stadtwerke Rechnung",
          category: body.includes("BADCAT") ? "TotallyInvalidCategory" : "Utilities",
          summary: "Electricity invoice, due mid-August.",
          language: "German",
          fullText:
            "Rechnung der Stadtwerke Neu-Ulm. Der Betrag von 149,90 EUR ist faellig am 2026-08-15. Kundennummer 55123. Bei Zahlungsverzug entstehen Mahngebuehren.",
          highlights: [
            { type: "payment", text: "Pay electricity bill", amount: "149,90 EUR", severity: "high" },
            // German date format on purpose — must be normalized to ISO.
            { type: "deadline", text: "Payment due", date: "15.08.2026", severity: "high" },
            { type: "critical", text: "Late fees on overdue payment", severity: "medium" },
            { type: "bogus", text: "should be dropped", severity: "high" }, // invalid type → filtered
          ],
          entities: [
            { name: "Stadtwerke Neu-Ulm", type: "organization" },
            { name: "55123", type: "account" },
          ],
          relations: [{ from: "55123", to: "Stadtwerke Neu-Ulm", label: "account at" }],
        });
      } else {
        // chat request → echo something grounded in the facts it was given
        content =
          "You owe 149,90 EUR to Stadtwerke Neu-Ulm, due 2026-08-15. Source: Stadtwerke Rechnung.";
      }
      res.end(JSON.stringify({ choices: [{ message: { content } }] }));
      return;
    }
    res.statusCode = 404;
    res.end("{}");
  });
});

await new Promise<void>((resolve) => server.listen(PORT, resolve));

process.env.AI_BASE_URL = `http://127.0.0.1:${PORT}/v1`;
process.env.AI_API_KEY = "test-key";
process.env.AI_MODEL = "mock-model";
process.env.AI_EMBED_MODEL = ""; // disable embeddings → keyword retrieval path

// Start each run from a clean store (the app persists to ../data on disk).
rmSync(new URL("../data", import.meta.url), { recursive: true, force: true });

const ai = await import("./ai.js");
const store = await import("./store.js");

after(() => {
  server.close();
  rmSync(new URL("../data", import.meta.url), { recursive: true, force: true });
});

test("toIsoDate normalizes common real-world date formats", () => {
  assert.equal(ai.toIsoDate("2026-08-15"), "2026-08-15"); // already ISO
  assert.equal(ai.toIsoDate("15.08.2026"), "2026-08-15"); // German
  assert.equal(ai.toIsoDate("15/08/2026"), "2026-08-15"); // European slash
  assert.equal(ai.toIsoDate("5-8-2026"), "2026-08-05"); // single digits
  assert.equal(ai.toIsoDate("2026/08/15"), "2026-08-15"); // year-first
  assert.equal(ai.toIsoDate("not a date"), undefined);
  assert.equal(ai.toIsoDate("32.13.2026"), undefined); // out of range
  assert.equal(ai.toIsoDate(undefined), undefined);
});

test("extractAmount / extractDate recover fields from text", () => {
  assert.equal(ai.extractAmount("Offener Betrag 149,90 EUR bitte zahlen"), "149,90 EUR");
  assert.equal(ai.extractAmount("Total: €1.299,00 due"), "€1.299,00");
  assert.equal(ai.extractAmount("no money here"), undefined);
  assert.equal(ai.extractDate("Please pay by 15.08.2026 at the latest"), "2026-08-15");
  assert.equal(ai.extractDate("due 2026-08-15"), "2026-08-15");
  assert.equal(ai.extractDate("sometime soon"), undefined);
});

test("analyze: OCR JSON is parsed and highlights normalized", async () => {
  const a = await ai.analyzeDocument({ text: "some invoice text" });
  assert.equal(a.title, "Stadtwerke Rechnung");
  assert.equal(a.category, "Utilities");

  // invalid highlight type filtered out; ids assigned
  assert.equal(a.highlights.length, 3);
  assert.ok(a.highlights.every((h) => h.id));

  const deadline = a.highlights.find((h) => h.type === "deadline");
  const payment = a.highlights.find((h) => h.type === "payment");
  assert.equal(deadline?.date, "2026-08-15"); // normalized from "15.08.2026"
  assert.equal(payment?.amount, "149,90 EUR");
  assert.equal(payment?.severity, "high");
});

test("invalid category from the model falls back to Other", async () => {
  const a = await ai.analyzeDocument({ text: "BADCAT invoice" });
  assert.equal(a.category, "Other");
});

test("store: upsert + knowledge-graph facts sheet includes money & dates", async () => {
  const a = await ai.analyzeDocument({ text: "x" });
  store.upsertDoc({ docId: "d1", title: a.title, createdAt: 1, analysis: a });

  const pieces = store.chunkText(a.fullText);
  store.setChunks(
    "d1",
    a.title,
    pieces.map((t) => ({ text: t, embedding: null })),
  );

  const facts = store.factsSheet();
  assert.ok(facts.includes("149,90 EUR"), "facts mention the amount");
  assert.ok(facts.includes("2026-08-15"), "facts mention the due date");
  assert.ok(facts.includes("Stadtwerke Neu-Ulm"), "facts mention the entity");
  assert.equal(store.listDocs().length, 1);
});

test("meta chunk makes titles/entities/amounts searchable for citations", async () => {
  const a = await ai.analyzeDocument({ text: "x" });
  const meta = store.metaText(a);
  assert.ok(meta.includes("Stadtwerke"), "meta includes title/entity");
  assert.ok(meta.includes("149,90"), "meta includes amount");

  store.setChunks("meta1", a.title, [{ text: meta, embedding: null }]);
  // A query using the entity/topic (not present verbatim in body) still matches.
  const hits = store.search("Stadtwerke electricity invoice", null, 5);
  assert.ok(hits.some((h) => h.docId === "meta1"), "entity/topic query hits via meta chunk");
  store.removeDoc("meta1");
});

test("retrieval: keyword search finds the relevant chunk", async () => {
  const hits = store.search("Kundennummer 55123", null, 5);
  assert.ok(hits.length >= 1);
  assert.ok(hits[0].score > 0, "top hit has a positive score");
  assert.equal(hits[0].docId, "d1");
});

test("chat: graph-aware answer returns and is grounded", async () => {
  const facts = store.factsSheet();
  const hits = store.search("what do I owe", null, 5);
  const answer = await ai.answerQuestion(
    "what do I owe and when is it due?",
    hits.map((h) => ({ title: h.title, text: h.text })),
    [],
    facts,
  );
  assert.ok(answer.includes("149,90 EUR"));
  assert.ok(answer.includes("2026-08-15"));
});

test("chunkText splits long text with overlap", () => {
  const long = "Sentence about invoices and deadlines. ".repeat(80);
  const chunks = store.chunkText(long, 300, 60);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((c) => c.length <= 360));
});

test("removeDoc clears the document and its chunks", () => {
  store.removeDoc("d1");
  assert.equal(store.listDocs().length, 0);
  assert.equal(store.search("Kundennummer", null, 5).length, 0);
});
