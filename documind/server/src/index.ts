import "dotenv/config";
import cors from "cors";
import express from "express";
import { analyzeDocument, answerQuestion, embedTexts, MODEL, type DocAnalysis } from "./ai.js";
import {
  chunkText,
  factsSheet,
  listDocs,
  removeDoc,
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

    const pieces = chunkText(a.fullText || "");
    if (pieces.length === 0) {
      setChunks(docId, title || a.title, []);
      res.json({ ok: true, chunks: 0, embedded: false });
      return;
    }
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

app.listen(PORT, () => {
  console.log(`\n  DocuMind backend → http://localhost:${PORT}`);
  console.log(`  Model: ${MODEL}`);
  if (!process.env.AI_API_KEY) {
    console.warn("  ⚠  AI_API_KEY is not set — copy server/.env.example to server/.env and fill it in.\n");
  } else {
    console.log("");
  }
});
