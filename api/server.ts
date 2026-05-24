/**
 * Express proxy server for the Neu-Ulm Müllkalender web build.
 *
 * Endpoints:
 *   GET /api/ics?districtId=5        → proxy ICS from neu-ulm.de
 *   GET /api/search?q=Lupinenweg     → Nominatim forward geocoding
 *   GET /api/reverse?lat=48.4&lon=10 → Nominatim reverse geocoding
 *   GET /api/health                  → health check
 *
 * For native (iOS/Android) builds this server is NOT required — the app
 * fetches directly from the city website (no CORS restriction on native).
 *
 * Usage:
 *   npm run api           (development, tsx watch)
 *   npm run api:prod      (production)
 *
 * Set PORT env var to override the default 3001.
 */

import express from "express";
import "dotenv/config";

const app = express();
const PORT = parseInt(process.env.PORT ?? "3001", 10);

// ── Shared headers ─────────────────────────────────────────────────────────────

const USER_AGENT = "NeuUlmWasteCalendarApp/1.4.0 (proxy; guedria.amine@gmail.com)";

// ── CORS ───────────────────────────────────────────────────────────────────────

app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  next();
});

app.options("*", (_req, res) => res.sendStatus(204));

// ── Health ─────────────────────────────────────────────────────────────────────

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, version: "1.3.0" });
});

// ── ICS proxy ─────────────────────────────────────────────────────────────────

/** Fetch ICS URLs from the city website (scraped once per process). */
let _icsUrlCache: Record<number, string> = {};
let _scraped = false;

/**
 * Try multiple HTML regex patterns so the scraper survives minor HTML changes.
 */
function _scrapeIcsUrls(html: string): Record<number, string> {
  const found: Record<number, string> = {};
  const patterns: RegExp[] = [
    /href="([^"]*\.ics[^"]*)"[^>]*>[^<]*Bezirk\s*(\d+)/gi,
    /href="([^"]+)"[^>]*>Abfuhrtermine \d{4}\s*[|–-]\s*Bezirk\s*(\d+)/gi,
    /href="([^"]*[Bb]ezirk[_-]?(\d+)[^"]*\.ics)"/gi,
    /href="([^"]+\.ics)"[^>]*>(?:[^<]*Bezirk\s*(\d+))/gi,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      const rawUrl = m[1];
      const rawId = m[2] ?? m[3];
      if (!rawUrl || !rawId) continue;
      const id = parseInt(rawId, 10);
      if (id >= 1 && id <= 8 && !found[id]) {
        found[id] = rawUrl.startsWith("http")
          ? rawUrl
          : `https://nu.neu-ulm.de${rawUrl}`;
      }
    }
  }
  return found;
}

/**
 * Fallback: probe predictable file-path patterns on the city server.
 * Tries current year and next year (for the year rollover window).
 */
async function _probeFallbackUrl(districtId: number): Promise<string | null> {
  const year = new Date().getFullYear();
  const candidates = [
    `https://nu.neu-ulm.de/fileadmin/user_upload/Abfallkalender_${year}_Bezirk_${districtId}.ics`,
    `https://nu.neu-ulm.de/fileadmin/user_upload/Abfallkalender_${year + 1}_Bezirk_${districtId}.ics`,
    `https://nu.neu-ulm.de/fileadmin/user_upload/abfallkalender_${year}_bezirk_${districtId}.ics`,
    `https://nu.neu-ulm.de/fileadmin/user_upload/Abfall/Abfallkalender_${year}_Bezirk_${districtId}.ics`,
    `https://nu.neu-ulm.de/fileadmin/user_upload/Abfallkalender/Abfallkalender_${year}_Bezirk_${districtId}.ics`,
    `https://nu.neu-ulm.de/fileadmin/user_upload/Abfuhrkalender_${year}_Bezirk_${districtId}.ics`,
  ];
  for (const url of candidates) {
    try {
      const r = await fetch(url, {
        method: "HEAD",
        signal: AbortSignal.timeout(5_000),
        headers: { "User-Agent": USER_AGENT },
      });
      if (r.ok) return url;
    } catch { /* try next */ }
  }
  return null;
}

async function resolveIcsUrl(districtId: number): Promise<string | null> {
  if (_icsUrlCache[districtId]) return _icsUrlCache[districtId];

  // ── 1. Scrape the city Abfallkalender page (done once per process) ─────────
  if (!_scraped) {
    _scraped = true;
    try {
      const res = await fetch(
        "https://nu.neu-ulm.de/buerger-service/leben-in-neu-ulm/abfall-sauberkeit/abfallkalender/",
        { signal: AbortSignal.timeout(12_000), headers: { "User-Agent": USER_AGENT } }
      );
      if (res.ok) {
        const found = _scrapeIcsUrls(await res.text());
        Object.assign(_icsUrlCache, found);
        console.log(`[ics] Scraped ${Object.keys(found).length} district URLs from city page`);
      }
    } catch (err) {
      console.warn("[ics] Scraping city page failed:", err);
    }
  }

  if (_icsUrlCache[districtId]) return _icsUrlCache[districtId];

  // ── 2. Probe fallback URL patterns ─────────────────────────────────────────
  console.log(`[ics] Probing fallback URLs for district ${districtId}`);
  const fallback = await _probeFallbackUrl(districtId);
  if (fallback) {
    _icsUrlCache[districtId] = fallback;
    return fallback;
  }

  return null;
}

app.get("/api/ics", async (req, res) => {
  const districtId = parseInt(String(req.query.districtId ?? "5"), 10);
  if (isNaN(districtId) || districtId < 1 || districtId > 8) {
    res.status(400).json({ error: "Invalid districtId (1-8)" });
    return;
  }

  try {
    const icsUrl = await resolveIcsUrl(districtId);

    if (!icsUrl) {
      res.status(404).json({ error: `No ICS URL found for district ${districtId}` });
      return;
    }

    const icsRes = await fetch(icsUrl, {
      signal: AbortSignal.timeout(15_000),
      headers: { "User-Agent": USER_AGENT },
    });

    if (!icsRes.ok) {
      res.status(502).json({ error: `City ICS server returned ${icsRes.status}` });
      return;
    }

    const text = await icsRes.text();
    if (!text.includes("BEGIN:VCALENDAR")) {
      res.status(502).json({ error: "Response does not look like ICS data" });
      return;
    }

    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.send(text);
  } catch (err) {
    console.error("[/api/ics]", err);
    res.status(502).json({ error: "Failed to fetch ICS from city" });
  }
});

// ── Geocoding proxy ────────────────────────────────────────────────────────────

app.get("/api/search", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  if (!q) {
    res.status(400).json({ error: "Missing q param" });
    return;
  }

  const query = q.toLowerCase().includes("neu-ulm") ? q : `${q}, Neu-Ulm`;
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&addressdetails=1&limit=5&countrycodes=de`;

  try {
    const nomRes = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
      headers: { "User-Agent": USER_AGENT },
    });
    if (!nomRes.ok) throw new Error(`Nominatim ${nomRes.status}`);
    const data = await nomRes.json();
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json(data);
  } catch (err) {
    console.error("[/api/search]", err);
    res.status(502).json({ error: "Geocoding failed" });
  }
});

app.get("/api/reverse", async (req, res) => {
  const lat = parseFloat(String(req.query.lat ?? ""));
  const lon = parseFloat(String(req.query.lon ?? ""));

  if (isNaN(lat) || isNaN(lon)) {
    res.status(400).json({ error: "Missing or invalid lat/lon" });
    return;
  }

  const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`;

  try {
    const nomRes = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
      headers: { "User-Agent": USER_AGENT },
    });
    if (!nomRes.ok) throw new Error(`Nominatim ${nomRes.status}`);
    const data = await nomRes.json();
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json(data);
  } catch (err) {
    console.error("[/api/reverse]", err);
    res.status(502).json({ error: "Reverse geocoding failed" });
  }
});

// ── Catch-all (unmatched API routes) ──────────────────────────────────────────

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "API endpoint not found" });
});

// ── Start ──────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`✅  API server running on http://localhost:${PORT}`);
});

export default app;
