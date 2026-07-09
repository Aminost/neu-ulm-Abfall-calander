import "dotenv/config";
import cors from "cors";
import express from "express";
import {
  analyzeDocument,
  answerQuestion,
  answerQuestionStream,
  embedTexts,
  MODEL,
  type DocAnalysis,
} from "./ai.js";
import {
  type BlobKind,
  chunkText,
  factsSheet,
  listDocs,
  metaText,
  readBlob,
  removeDoc,
  saveBlob,
  search,
  setChunks,
  upsertDoc,
} from "./store.js";

const app = express();
app.use(cors());
// Base64 page images can be a few MB — give the JSON parser room.
app.use(express.json({ limit: "30mb" }));

const PORT = Number(process.env.PORT) || 3001;

function asyncRoute(
  fn: (req: express.Request, res: express.Response) => Promise<void>,
): express.RequestHandler {
  return (req, res) => {
    fn(req, res).catch((err) => {
      console.error(err);
      res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
    });
  };
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, model: MODEL, hasKey: Boolean(process.env.AI_API_KEY), documents: listDocs().length });
});

// OCR + classify + extract + knowledge graph, in one pass.
app.post(
  "/api/analyze",
  asyncRoute(async (req, res) => {
    const { imageBase64, imagesBase64, mimeType, text } = req.body ?? {};
    if (!imageBase64 && !imagesBase64 && !text) {
      res.status(400).json({ error: "Provide imageBase64, imagesBase64, or text." });
      return;
    }
    const analysis = await analyzeDocument({ imageBase64, imagesBase64, mimeType, text });
    res.json({ analysis });
  }),
);

// Upsert a document: store its metadata/analysis (cross-device + knowledge graph)
// and index its text for retrieval.
app.post(
  "/api/documents",
  asyncRoute(async (req, res) => {
    const { docId, title, createdAt, analysis } = req.body ?? {};
    if (!docId || !analysis) {
      res.status(400).json({ error: "Provide docId and analysis." });
      return;
    }
    const a = analysis as DocAnalysis;
    upsertDoc({ docId, title: title || a.title, createdAt: createdAt || Date.now(), analysis: a });

    // Meta chunk first (title/entities/amounts/dates), then the body text.
    const pieces = [metaText(a), ...chunkText(a.fullText || "")].filter((p) => p.trim());
    const embeddings = await embedTexts(pieces); // null when embeddings unavailable
    setChunks(
      docId,
      title || a.title,
      pieces.map((t, i) => ({ text: t, embedding: embeddings ? embeddings[i] : null })),
    );
    res.json({ ok: true, chunks: pieces.length, embedded: embeddings !== null });
  }),
);

// Fetch all stored documents — lets a new device restore the library.
app.get(
  "/api/documents",
  asyncRoute(async (_req, res) => {
    res.json({ documents: listDocs() });
  }),
);

app.post(
  "/api/documents/delete",
  asyncRoute(async (req, res) => {
    const { docId } = req.body ?? {};
    if (docId) removeDoc(docId);
    res.json({ ok: true });
  }),
);

// Store / fetch the original scan (PDF or page image) for full cross-device restore.
app.post(
  "/api/blob",
  asyncRoute(async (req, res) => {
    const { docId, kind, base64 } = req.body ?? {};
    if (!docId || (kind !== "pdf" && kind !== "image") || typeof base64 !== "string") {
      res.status(400).json({ error: "Provide docId, kind ('pdf'|'image'), and base64." });
      return;
    }
    saveBlob(docId, kind as BlobKind, base64);
    res.json({ ok: true });
  }),
);

app.get(
  "/api/blob",
  asyncRoute(async (req, res) => {
    const docId = String(req.query.docId ?? "");
    const kind = String(req.query.kind ?? "");
    if (!docId || (kind !== "pdf" && kind !== "image")) {
      res.status(400).json({ error: "Provide docId and kind ('pdf'|'image')." });
      return;
    }
    const base64 = readBlob(docId, kind as BlobKind);
    if (!base64) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json({ base64 });
  }),
);

// Retrieval-augmented, knowledge-graph-aware question answering.
app.post(
  "/api/chat",
  asyncRoute(async (req, res) => {
    const { question, history } = req.body ?? {};
    if (!question || typeof question !== "string") {
      res.status(400).json({ error: "Provide a question." });
      return;
    }
    const embedded = await embedTexts([question]);
    const queryEmbedding = embedded ? embedded[0] : null;
    const hits = search(question, queryEmbedding, 5).filter((h) => h.score > 0.05);

    const answer = await answerQuestion(
      question,
      hits.map((h) => ({ title: h.title, text: h.text })),
      Array.isArray(history) ? history : [],
      factsSheet(),
    );

    const seen = new Set<string>();
    const citations = hits
      .filter((h) => (seen.has(h.docId) ? false : (seen.add(h.docId), true)))
      .slice(0, 3)
      .map((h) => ({ docId: h.docId, title: h.title, snippet: h.text.slice(0, 140) }));

    res.json({ answer, citations });
  }),
);

// Streaming version of /api/chat. Emits a JSON header line with citations,
// a record-separator marker (␞), then the answer text token-by-token.
app.post(
  "/api/chat/stream",
  asyncRoute(async (req, res) => {
    const { question, history } = req.body ?? {};
    if (!question || typeof question !== "string") {
      res.status(400).json({ error: "Provide a question." });
      return;
    }

    const embedded = await embedTexts([question]);
    const queryEmbedding = embedded ? embedded[0] : null;
    const hits = search(question, queryEmbedding, 5).filter((h) => h.score > 0.05);

    const seen = new Set<string>();
    const citations = hits
      .filter((h) => (seen.has(h.docId) ? false : (seen.add(h.docId), true)))
      .slice(0, 3)
      .map((h) => ({ docId: h.docId, title: h.title, snippet: h.text.slice(0, 140) }));

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.write(JSON.stringify({ citations }) + "\n␞\n");

    try {
      await answerQuestionStream(
        question,
        hits.map((h) => ({ title: h.title, text: h.text })),
        Array.isArray(history) ? history : [],
        factsSheet(),
        (delta) => res.write(delta),
      );
    } catch (err) {
      res.write("\n\n[Error generating answer: " + (err instanceof Error ? err.message : "unknown") + "]");
    }
    res.end();
  }),
);

app.listen(PORT, () => {
  console.log(`\n  DocuMind backend → http://localhost:${PORT}`);
  console.log(`  Model: ${MODEL}`);
  if (!process.env.AI_API_KEY) {
    console.log("  Mode:  offline heuristics (no AI_API_KEY set)");
    console.log("         deadlines, costs, highlights & cited Q&A work from text/PDF documents.");
    console.log("         Add AI_API_KEY to server/.env for vision OCR of photos + richer answers.\n");
  } else {
    console.log("");
  }
});
