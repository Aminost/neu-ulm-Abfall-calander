// Tests for the OFFLINE path: the heuristic analyzer + extractive answerer, and
// the end-to-end offline pipeline through analyzeDocument/answerQuestion when no
// model is configured. This proves the core promise — detect deadlines, costs,
// payments, critical items, highlight them, and answer with sources — works with
// zero network and zero API key.
//
// Run as part of:  npm test

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

// Guarantee offline mode regardless of the developer's shell env.
delete process.env.AI_API_KEY;
process.env.AI_EMBED_MODEL = "";

const {
  heuristicAnalyze,
  heuristicAnswer,
  extractDates,
  classify,
  segments,
  extractEntities,
} = await import("./heuristics.js");
const ai = await import("./ai.js");

// A realistic German utility invoice with a due date, amount, and dunning notice.
const INVOICE = `Stadtwerke Neu-Ulm GmbH
Rechnung Nr. 2026-55123
Kundennummer: 55123

Sehr geehrte Kundin,
der Rechnungsbetrag von 149,90 EUR ist fällig am 15.08.2026.
Bitte überweisen Sie den Betrag fristgerecht auf unser Konto DE12 3456 7890 1234 5678 90.
Bei Zahlungsverzug entstehen Mahngebühren und die Belieferung kann eingestellt werden.`;

const FIXED_TODAY = new Date("2026-07-09T00:00:00Z");

test("extractDates handles absolute German, ISO, and relative phrasing", () => {
  assert.deepEqual(extractDates("fällig am 15.08.2026"), ["2026-08-15"]);
  assert.deepEqual(extractDates("due 2026-08-15"), ["2026-08-15"]);
  assert.deepEqual(extractDates("Betrag bis 15.08.26"), ["2026-08-15"]); // 2-digit year
  assert.deepEqual(extractDates("innerhalb von 14 Tagen", FIXED_TODAY), ["2026-07-23"]);
  assert.deepEqual(extractDates("within 2 weeks", FIXED_TODAY), ["2026-07-23"]);
  assert.deepEqual(extractDates("no dates here"), []);
});

test("classify routes documents to the right category by keywords", () => {
  assert.equal(classify(INVOICE), "Utilities"); // Stadtwerke/Strom/Rechnung
  assert.equal(classify("Ihre Versicherung: Beitrag zur Haftpflicht Police 998"), "Insurance");
  assert.equal(classify("Finanzamt Bescheid: Ihre Steuer, Aktenzeichen 12/345"), "Government");
  assert.equal(classify("nothing recognizable here"), "Other");
});

test("segments splits on newlines and sentence boundaries", () => {
  const segs = segments("Line one.\nLine two. Line three!");
  assert.ok(segs.length >= 3);
  assert.ok(segs.includes("Line one."));
});

test("heuristicAnalyze extracts payment, deadline, critical + graph from a real invoice", () => {
  const a = heuristicAnalyze(INVOICE, FIXED_TODAY);

  assert.equal(a.category, "Utilities");
  assert.equal(a.language, "German");
  assert.ok(a.title.length > 0 && a.title !== "Untitled document");

  const payment = a.highlights.find((h) => h.type === "payment");
  assert.ok(payment, "should detect a payment");
  assert.match(payment!.amount ?? "", /149,90\s*EUR/);

  const deadline = a.highlights.find((h) => h.type === "deadline");
  assert.ok(deadline, "should detect a deadline");
  assert.equal(deadline!.date, "2026-08-15");
  assert.equal(deadline!.severity, "medium"); // 37 days out → medium (high only within 7 days)

  const critical = a.highlights.find((h) => h.type === "critical");
  assert.ok(critical, "should detect the dunning / cut-off warning");

  // Knowledge graph: the sender organization + amount/date nodes exist.
  const org = a.entities.find((e) => e.type === "organization");
  assert.ok(org && /Stadtwerke Neu-Ulm/.test(org.name), "should extract the organization");
  assert.ok(a.entities.some((e) => e.type === "amount"));
  assert.ok(a.entities.some((e) => e.type === "date"));
  // A relation connects the org to what it's owed / when.
  assert.ok(a.relations.some((r) => r.label === "owes" || r.label === "due"));
});

test("cue matching is umlaut-insensitive (fällig == faellig)", () => {
  // Umlaut-stripped German (common in typed docs / lossy OCR) must still work.
  const a = heuristicAnalyze("Der Betrag von 80,00 EUR ist faellig am 01.09.2026.", FIXED_TODAY);
  const deadline = a.highlights.find((h) => h.type === "deadline");
  assert.ok(deadline, "faellig should be recognized as a deadline cue");
  assert.equal(deadline!.date, "2026-09-01");
});

test("heuristicAnalyze resolves a relative deadline against today", () => {
  const a = heuristicAnalyze("Bitte zahlen Sie den Betrag von 50,00 EUR innerhalb von 14 Tagen.", FIXED_TODAY);
  const deadline = a.highlights.find((h) => h.type === "deadline");
  assert.ok(deadline, "relative deadline should be detected");
  assert.equal(deadline!.date, "2026-07-23");
});

test("extractEntities finds IBANs and reference numbers", () => {
  const ents = extractEntities(INVOICE, []);
  assert.ok(ents.some((e) => e.type === "account" && /DE12/.test(e.name)), "IBAN");
  assert.ok(ents.some((e) => e.type === "reference" && /55123/.test(e.name)), "customer/invoice ref");
});

test("heuristicAnswer answers a money question with the amount and source", () => {
  const facts = "• Pay Stadtwerke Neu-Ulm — 149,90 EUR — due 2026-08-15 (Stadtwerke Rechnung)";
  const out = heuristicAnswer(
    "How much do I owe?",
    facts,
    [{ title: "Stadtwerke Rechnung", text: "Der Betrag von 149,90 EUR ist fällig am 15.08.2026." }],
  );
  assert.match(out, /149,90\s*EUR/);
  assert.match(out, /Stadtwerke/);
});

test("heuristicAnswer answers a deadline question", () => {
  const facts = "• Deadline: 2026-08-15 — Stadtwerke Rechnung\n• Deadline: 2026-09-01 — Finanzamt";
  const out = heuristicAnswer("When are my deadlines?", facts, []);
  assert.match(out, /2026-08-15/);
  assert.match(out, /deadline/i);
});

test("heuristicAnswer degrades gracefully with an empty knowledge base", () => {
  const out = heuristicAnswer("How much do I owe?", "", []);
  assert.match(out, /don't have|scan or import/i);
});

// ── End-to-end OFFLINE pipeline: no key, no network ─────────────────────────

test("analyzeDocument works offline (no API key) via heuristics", async () => {
  assert.equal(ai.hasModel(), false, "must be running without a model");
  const analysis = await ai.analyzeDocument({ text: INVOICE });
  assert.ok(analysis.highlights.some((h) => h.type === "payment"));
  assert.ok(analysis.highlights.some((h) => h.type === "deadline"));
  assert.equal(analysis.category, "Utilities");
});

test("answerQuestion works offline (no API key) and cites its source", async () => {
  const facts = "• Pay Stadtwerke Neu-Ulm — 149,90 EUR — due 2026-08-15 (Stadtwerke Rechnung)";
  const out = await ai.answerQuestion(
    "How much do I owe and when is it due?",
    [{ title: "Stadtwerke Rechnung", text: "Der Betrag von 149,90 EUR ist fällig am 15.08.2026." }],
    [],
    facts,
  );
  assert.match(out, /149,90\s*EUR/);
  assert.match(out, /Stadtwerke/);
});

test("answerQuestionStream works offline (no API key) and streams tokens", async () => {
  let acc = "";
  await ai.answerQuestionStream(
    "What deadlines do I have?",
    [],
    [],
    "• Deadline: 2026-08-15 — Stadtwerke Rechnung",
    (d) => (acc += d),
  );
  assert.match(acc, /2026-08-15/);
});

// ── Offline OCR: a PHOTOGRAPHED document is read locally (no model, no network) ──

const ocr = await import("./ocr.js");
after(() => ocr.terminateOcr());

test("offline OCR reads a scanned invoice image and feeds the analyzer", async () => {
  const png = readFileSync(fileURLToPath(new URL("./fixtures/invoice.png", import.meta.url)));
  const text = await ocrImages_(png);
  assert.match(text, /Stadtwerke/i, "OCR should read the sender");
  assert.match(text, /149,90/, "OCR should read the amount");

  // Full offline scan pipeline: analyzeDocument with an image and no key.
  const analysis = await ai.analyzeDocument({ imageBase64: png.toString("base64"), mimeType: "image/png" });
  assert.equal(analysis.category, "Utilities");
  assert.ok(analysis.highlights.some((h) => h.type === "payment" && /149,90/.test(h.amount ?? "")));
  assert.ok(analysis.highlights.some((h) => h.type === "deadline"));

  async function ocrImages_(buf: Buffer): Promise<string> {
    return ocr.ocrImages([buf.toString("base64")], "image/png");
  }
});
