// Offline OCR via Tesseract (WASM). Lets the app read PHOTOGRAPHED documents
// with no network and no API key — the language data is bundled in ../tessdata,
// so a scanned invoice can be transcribed and then analyzed by the local
// heuristics. When a vision model IS configured, ai.ts uses that instead (better
// on messy real-world scans); this is the zero-dependency fallback path.
//
// German + English are bundled (the app's target: German bureaucracy). The
// Tesseract worker is created lazily and reused across calls.

import { fileURLToPath } from "node:url";

const TESSDATA = fileURLToPath(new URL("../tessdata", import.meta.url));

// Loaded lazily so importing this module (and booting the server) stays cheap
// and doesn't pull in the WASM engine unless OCR is actually needed.
let workerPromise: Promise<any> | null = null;

async function getWorker(): Promise<any> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import("tesseract.js");
      return createWorker(["deu", "eng"], 1, {
        langPath: TESSDATA,
        cachePath: TESSDATA,
        gzip: true,
      });
    })();
  }
  return workerPromise;
}

/** True when the bundled language data is present (so OCR can run offline). */
export async function ocrAvailable(): Promise<boolean> {
  try {
    const { access } = await import("node:fs/promises");
    await access(`${TESSDATA}/eng.traineddata.gz`);
    return true;
  } catch {
    return false;
  }
}

/**
 * OCR one or more page images (base64, no data: prefix needed) into a single
 * text block. Returns "" if OCR is unavailable or fails, so callers can degrade
 * gracefully rather than throw.
 */
export async function ocrImages(imagesBase64: string[], mimeType = "image/jpeg"): Promise<string> {
  if (!imagesBase64.length) return "";
  if (!(await ocrAvailable())) return "";
  try {
    const worker = await getWorker();
    const pages: string[] = [];
    for (const b64 of imagesBase64) {
      const buf = Buffer.from(b64, "base64");
      const { data } = await worker.recognize(buf);
      const text = (data?.text ?? "").trim();
      if (text) pages.push(text);
    }
    return pages.join("\n\n").trim();
  } catch (err) {
    console.warn(`Offline OCR failed (${err instanceof Error ? err.message : err}).`);
    return "";
  }
}

/** Release the Tesseract worker (used in tests / graceful shutdown). */
export async function terminateOcr(): Promise<void> {
  if (workerPromise) {
    try {
      const w = await workerPromise;
      await w.terminate();
    } catch {
      /* ignore */
    }
    workerPromise = null;
  }
}
