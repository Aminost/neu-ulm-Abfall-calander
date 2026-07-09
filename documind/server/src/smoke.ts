// Live smoke test — verifies the REAL configured model (KIT ki-toolbox, OpenAI,
// …) end to end: analyze a sample document, store it, build the knowledge-graph
// facts, and answer a question with sources. This is the one check that needs a
// real AI_API_KEY, so it's a separate manual script rather than part of `npm test`.
//
// Usage:
//   cd server && npm run smoke        (reads AI_* from server/.env)

import "dotenv/config";
import { analyzeDocument, answerQuestion, MODEL } from "./ai.js";
import { chunkText, factsSheet, removeDoc, search, setChunks, upsertDoc } from "./store.js";

const SAMPLE_DOCUMENT = `Stadtwerke Neu-Ulm GmbH
Rechnung Nr. 2026-33821
Kundennummer: 55123

Sehr geehrte Frau Guedria,

anbei erhalten Sie Ihre Jahresabrechnung für Strom.
Der offene Betrag beträgt 149,90 EUR und ist fällig am 15.08.2026.
Bitte überweisen Sie den Betrag rechtzeitig. Bei Zahlungsverzug fallen
Mahngebühren in Höhe von 5,00 EUR an, und die Belieferung kann eingestellt werden.

Mit freundlichen Grüßen
Ihre Stadtwerke Neu-Ulm`;

function line(label: string, value: string) {
  console.log(`  ${label.padEnd(12)} ${value}`);
}

async function main() {
  if (!process.env.AI_API_KEY) {
    console.error("✗ AI_API_KEY is not set. Copy server/.env.example to server/.env and fill it in.");
    process.exit(1);
  }

  console.log(`\n▶ Analyzing a sample invoice with model "${MODEL}" …\n`);

  const analysis = await analyzeDocument({ text: SAMPLE_DOCUMENT });

  line("Title:", analysis.title);
  line("Category:", analysis.category);
  line("Language:", analysis.language);
  line("Summary:", analysis.summary);
  console.log("\n  Highlights:");
  for (const h of analysis.highlights) {
    const extra = [h.date ? `due ${h.date}` : "", h.amount ?? ""].filter(Boolean).join(", ");
    console.log(`   • [${h.type}/${h.severity}] ${h.text}${extra ? ` (${extra})` : ""}`);
  }
  console.log("\n  Entities:", analysis.entities.map((e) => `${e.name} [${e.type}]`).join(", ") || "—");

  // Index + knowledge-graph-aware chat.
  upsertDoc({ docId: "smoke", title: analysis.title, createdAt: Date.now(), analysis });
  const pieces = chunkText(analysis.fullText || SAMPLE_DOCUMENT);
  setChunks("smoke", analysis.title, pieces.map((t) => ({ text: t, embedding: null })));

  const question = "How much do I owe and when is it due?";
  console.log(`\n▶ Asking: "${question}"\n`);
  const answer = await answerQuestion(
    question,
    search(question, null, 5).map((h) => ({ title: h.title, text: h.text })),
    [],
    factsSheet(),
  );
  console.log("  " + answer.replace(/\n/g, "\n  "));

  removeDoc("smoke");

  // Heuristic pass/fail on extraction quality.
  const hasPayment = analysis.highlights.some((h) => h.type === "payment");
  const hasDeadline = analysis.highlights.some((h) => h.type === "deadline");
  console.log("\n──────────────────────────────────────────");
  if (hasPayment && hasDeadline) {
    console.log("✅ Extraction looks good: payment and deadline detected.");
  } else {
    console.log(
      `⚠ Model response is missing ${!hasPayment ? "a payment" : ""}${!hasPayment && !hasDeadline ? " and " : ""}${!hasDeadline ? "a deadline" : ""}.`,
    );
    console.log("  The pipeline works, but the model/prompt may need tuning for your documents.");
  }
  console.log("");
}

main().catch((err) => {
  console.error("\n✗ Smoke test failed:", err instanceof Error ? err.message : err);
  console.error("  Check AI_BASE_URL / AI_MODEL / AI_API_KEY in server/.env and that the model supports chat.");
  process.exit(1);
});
