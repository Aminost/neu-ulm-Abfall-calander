/**
 * lib/dataFetcher.ts
 *
 * Source-of-truth strategy for the calendar:
 *
 *   1. Built-in 2026 calendar  — always available, baked in from the official PDF
 *      (lib/calendar2026.ts). Returned IMMEDIATELY so the app is never empty.
 *
 *   2. Cached network ICS      — populated from the city ICS endpoint when we
 *      successfully fetched it before. Used to override the built-in if newer.
 *
 *   3. Fresh network ICS       — fetched in the background (or on demand if no
 *      cache exists). Refreshes the cache for next launch.
 *
 *   4. Manual import           — fallback: a .ics file the user uploaded in
 *      Settings (also saved in AsyncStorage).
 *
 * The result is that the calendar is ALWAYS populated within a few millisecond
 * of mount, regardless of network state. Any newer data found online seamlessly
 * replaces the built-in on the next render.
 */
import { Platform } from "react-native";
import Constants from "expo-constants";
import { CollectionEvent, parseICS } from "./icsParser";
import { storage } from "./storage";
// NOTE: calendar2026 is intentionally LAZY-loaded (dynamic import) so the 12 KB
// of bundled fallback data is only parsed when the network and the cache fail.
// Keeps app-launch hot path light, especially in Expo Go on low-RAM devices.

// ── Constants ──────────────────────────────────────────────────────────────────

/** AsyncStorage key for a manually uploaded ICS file (from Settings). */
export const IMPORTED_ICS_KEY = "importedIcs";

/** Cache keys — versioned so old cache entries are ignored after parser updates. */
const cacheKey   = (id: number) => `ics_v3_${id}`;
const cacheTsKey = (id: number) => `ics_v3_ts_${id}`;

/** Background refresh after this age. */
const SOFT_TTL_MS = 7  * 24 * 60 * 60 * 1000; // 7 days
/** Force fresh fetch (still serves cache while waiting). */
const HARD_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const USER_AGENT = "NeuUlmMuellkalender/2.0 (https://github.com/aminoste/neu-ulm-muellkalender)";

// ── API base ───────────────────────────────────────────────────────────────────

function getApiBase(): string {
  const envUrl = process.env.EXPO_PUBLIC_API_URL;
  if (envUrl) return envUrl.replace(/\/$/, "");
  const extra = Constants.expoConfig?.extra as { apiUrl?: string } | undefined;
  if (extra?.apiUrl) return extra.apiUrl.replace(/\/$/, "");
  return "";
}

/**
 * Browsers forbid setting `User-Agent` via fetch (forbidden header). Native
 * platforms allow it and Nominatim's fair-use policy expects it.
 */
function nominatimHeaders(): Record<string, string> {
  if (Platform.OS === "web") return {};
  return { "User-Agent": USER_AGENT };
}

// ── Built-in fallback helper ───────────────────────────────────────────────────

/**
 * Parse the baked-in 2026 calendar for a given Bezirk. Always succeeds for
 * 1–8. Loaded lazily — the 12 KB of compact data is only parsed the first
 * time the fallback is actually needed.
 */
async function getBuiltinEvents(districtId: number): Promise<CollectionEvent[]> {
  try {
    const mod = await import("./calendar2026");
    const ics = mod.buildBuiltinIcs(districtId);
    if (!ics) return [];
    return parseICS(ics);
  } catch (err) {
    console.error("getBuiltinEvents: lazy import / parse error", err);
    return [];
  }
}

// ── Main export ────────────────────────────────────────────────────────────────

/**
 * Fetch waste-collection events for a district. Always returns events for a
 * valid district id (1-8), thanks to the built-in 2026 fallback.
 *
 *   - Returns the freshest available data: cache > built-in if cache is newer.
 *   - Triggers a background network refresh whenever the cache is stale.
 */
export async function fetchCollectionEvents(
  districtId: number
): Promise<CollectionEvent[]> {
  const [cachedRaw, cachedTsStr] = await Promise.all([
    storage.getItem(cacheKey(districtId)),
    storage.getItem(cacheTsKey(districtId)),
  ]);

  const cacheAge = cachedTsStr ? Date.now() - Number(cachedTsStr) : Infinity;

  // 2. If we have a fresh cache, parse and prefer it.
  if (cachedRaw && cacheAge < HARD_TTL_MS) {
    try {
      const events = parseICS(cachedRaw);
      if (events.length > 0) {
        if (cacheAge > SOFT_TTL_MS) {
          // Refresh quietly in the background.
          void _fetchAndCache(districtId);
        }
        return events;
      }
    } catch (err) {
      console.warn("fetchCollectionEvents: cached ICS unparseable", err);
    }
  }

  // 3. Try the network. Wait at most ~12s; otherwise fall back.
  try {
    const fresh = await _fetchAndCache(districtId);
    if (fresh.length > 0) return fresh;
  } catch (err) {
    console.warn("fetchCollectionEvents: network fetch failed", err);
  }

  // 4. Last-resort fallbacks: stale cache > manual import > built-in 2026.
  if (cachedRaw) {
    try {
      const events = parseICS(cachedRaw);
      if (events.length > 0) {
        console.info("fetchCollectionEvents: using stale cache (network unavailable)");
        return events;
      }
    } catch { /* ignore */ }
  }

  const imported = await storage.getItem(IMPORTED_ICS_KEY);
  if (imported) {
    try {
      const events = parseICS(imported);
      if (events.length > 0) {
        console.info("fetchCollectionEvents: using manually imported ICS");
        return events;
      }
    } catch { /* ignore */ }
  }

  // Last-resort: the baked-in 2026 calendar. Lazy-loaded so it doesn't
  // bloat the app-launch parse cost.
  const builtin = await getBuiltinEvents(districtId);
  if (builtin.length > 0) {
    console.info(`fetchCollectionEvents: using built-in 2026 calendar for Bezirk ${districtId}`);
    return builtin;
  }

  console.warn(`fetchCollectionEvents: no data available for district ${districtId}`);
  return [];
}

/** Force-invalidate the cache for a district (e.g. after manual ICS import). */
export async function clearIcsCache(districtId: number): Promise<void> {
  await Promise.all([
    storage.removeItem(cacheKey(districtId)),
    storage.removeItem(cacheTsKey(districtId)),
  ]);
}

/**
 * Force-refresh: clears the ICS cache for a district, fetches fresh data
 * directly from the city website, and returns events.
 * Falls back to the built-in 2026 calendar if the network is unavailable.
 */
export async function forceRefreshIcs(
  districtId: number
): Promise<CollectionEvent[]> {
  await clearIcsCache(districtId);
  try {
    const fresh = await _fetchAndCache(districtId);
    if (fresh.length > 0) return fresh;
  } catch (err) {
    console.warn(`forceRefreshIcs: network failed for district ${districtId}`, err);
  }
  // Network failed — fall back to built-in calendar so UI stays populated.
  return getBuiltinEvents(districtId);
}

/**
 * Returns the Unix timestamp (ms) of the last successful ICS cache write for
 * the given district, or null if no cache has ever been stored.
 */
export async function getLastUpdateTimestamp(
  districtId: number
): Promise<number | null> {
  const tsStr = await storage.getItem(cacheTsKey(districtId));
  if (!tsStr) return null;
  const ts = Number(tsStr);
  return isNaN(ts) ? null : ts;
}

// ── Internal: network fetch + cache ───────────────────────────────────────────

async function _fetchAndCache(districtId: number): Promise<CollectionEvent[]> {
  const raw = await _fetchRawIcs(districtId);
  if (!raw) return [];
  try {
    const events = parseICS(raw);
    if (events.length > 0) {
      await Promise.all([
        storage.setItem(cacheKey(districtId), raw),
        storage.setItem(cacheTsKey(districtId), String(Date.now())),
      ]);
      return events;
    }
    console.warn(`_fetchAndCache: ICS for district ${districtId} parsed to 0 events`);
  } catch (err) {
    console.warn(`_fetchAndCache: parse error for district ${districtId}`, err);
  }
  return [];
}

async function _fetchRawIcs(districtId: number): Promise<string | null> {
  const apiBase = getApiBase();

  // Via API proxy (required on web — city site has no CORS headers)
  if (apiBase) {
    try {
      const res = await fetch(`${apiBase}/api/ics?districtId=${districtId}`, {
        signal: AbortSignal.timeout(12_000),
      });
      if (res.ok) {
        const text = await res.text();
        if (text.includes("BEGIN:VCALENDAR")) return text;
      }
    } catch (err) {
      console.warn("_fetchRawIcs: proxy attempt failed", err);
    }
  }

  // Direct fetch — only on native (CORS restriction blocks this on web)
  if (Platform.OS !== "web") {
    try {
      const url = await resolveDirectIcsUrl(districtId);
      if (url) {
        const res = await fetch(url, {
          signal: AbortSignal.timeout(15_000),
          headers: { "User-Agent": USER_AGENT },
        });
        if (res.ok) {
          const text = await res.text();
          if (text.includes("BEGIN:VCALENDAR")) return text;
        }
      }
    } catch (err) {
      console.warn("_fetchRawIcs: direct attempt failed", err);
    }
  }

  return null;
}

// ── ICS URL resolution (scrape city website) ─────────────────────────────────

const _urlCache: Record<number, string> = {};
let _scraped = false;

async function _tryFallbackUrls(districtId: number): Promise<string | null> {
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
      const res = await fetch(url, {
        method: "HEAD",
        signal: AbortSignal.timeout(5_000),
        headers: { "User-Agent": USER_AGENT },
      });
      if (res.ok) return url;
    } catch { /* try next */ }
  }
  return null;
}

async function resolveDirectIcsUrl(districtId: number): Promise<string | null> {
  if (_urlCache[districtId]) return _urlCache[districtId];

  // 1. Scrape the city Abfallkalender page once per session.
  if (!_scraped) {
    _scraped = true;
    try {
      const res = await fetch(
        "https://nu.neu-ulm.de/buerger-service/leben-in-neu-ulm/abfall-sauberkeit/abfallkalender/",
        {
          signal: AbortSignal.timeout(10_000),
          headers: { "User-Agent": USER_AGENT },
        }
      );
      if (res.ok) {
        const html = await res.text();
        const patterns = [
          /href="([^"]*\.ics[^"]*)"[^>]*>[^<]*Bezirk\s*(\d+)/gi,
          /href="([^"]+)"[^>]*>Abfuhrtermine \d{4}\s*[|–-]\s*Bezirk\s*(\d+)/gi,
          /href="([^"]+\.ics)"[^>]*>(?:[^<]*Bezirk\s*(\d+)|Bezirk\s*(\d+)[^<]*)/gi,
          /href="([^"]*[Bb]ezirk[_-]?(\d+)[^"]*\.ics)"/gi,
        ];
        for (const re of patterns) {
          let m: RegExpExecArray | null;
          while ((m = re.exec(html)) !== null) {
            const rawUrl = m[1];
            const rawId = m[2] ?? m[3] ?? m[4];
            if (!rawUrl || !rawId) continue;
            const url = rawUrl.startsWith("http")
              ? rawUrl
              : `https://nu.neu-ulm.de${rawUrl}`;
            const id = parseInt(rawId, 10);
            if (id >= 1 && id <= 8 && !_urlCache[id]) {
              _urlCache[id] = url;
            }
          }
        }
      }
    } catch (err) {
      console.warn("resolveDirectIcsUrl: scrape failed", err);
    }
  }

  if (_urlCache[districtId]) return _urlCache[districtId];

  // 2. Try predictable URL patterns.
  const fallback = await _tryFallbackUrls(districtId);
  if (fallback) {
    _urlCache[districtId] = fallback;
    return fallback;
  }

  return null;
}

// ── Geocoding ──────────────────────────────────────────────────────────────────

/** Bounding box around the city of Neu-Ulm — used to filter Nominatim results. */
const NEU_ULM_BBOX = {
  // viewbox is "minLon,minLat,maxLon,maxLat" — generous enough to cover all
  // Stadtteile from Ludwigsfeld in the north to Holzschwang in the south.
  minLon: 9.94,
  minLat: 48.28,
  maxLon: 10.16,
  maxLat: 48.48,
};

function isWithinNeuUlm(lat: number, lon: number): boolean {
  return (
    lat >= NEU_ULM_BBOX.minLat &&
    lat <= NEU_ULM_BBOX.maxLat &&
    lon >= NEU_ULM_BBOX.minLon &&
    lon <= NEU_ULM_BBOX.maxLon
  );
}

/** Forward geocoding — address string → list of candidate results. */
export async function searchAddress(query: string): Promise<NominatimResult[]> {
  const apiBase = getApiBase();

  const q = query.toLowerCase().includes("neu-ulm") ? query : `${query}, Neu-Ulm`;
  const viewbox = `${NEU_ULM_BBOX.minLon},${NEU_ULM_BBOX.maxLat},${NEU_ULM_BBOX.maxLon},${NEU_ULM_BBOX.minLat}`;

  const url = apiBase
    ? `${apiBase}/api/search?q=${encodeURIComponent(q)}`
    : `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}` +
      `&format=json&addressdetails=1&limit=8&countrycodes=de` +
      `&viewbox=${viewbox}&bounded=1`;

  const res = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    headers: nominatimHeaders(),
  });
  if (!res.ok) throw new Error(`Search failed: ${res.status}`);
  const all = (await res.json()) as NominatimResult[];

  // Filter: must be within Neu-Ulm bbox AND have a Neu-Ulm postal code or city.
  return all.filter((r) => {
    const lat = parseFloat(r.lat);
    const lon = parseFloat(r.lon);
    if (!isFinite(lat) || !isFinite(lon)) return false;
    if (!isWithinNeuUlm(lat, lon)) return false;
    const postcode = r.address?.postcode ?? "";
    const city = (r.address?.city ?? r.address?.town ?? r.address?.village ?? "").toLowerCase();
    // Neu-Ulm postcodes are 89231, 89233 (Pfuhl), 89233 also covers some
    // Stadtteile. We accept any 8923x postcode and any address whose city
    // contains "neu-ulm".
    if (postcode.startsWith("8923")) return true;
    if (city.includes("neu-ulm")) return true;
    return false;
  });
}

/** Reverse geocoding — coordinates → address. */
export async function reverseGeocode(
  lat: number,
  lon: number
): Promise<NominatimReverseResult> {
  const apiBase = getApiBase();
  const url = apiBase
    ? `${apiBase}/api/reverse?lat=${lat}&lon=${lon}`
    : `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&addressdetails=1`;

  const res = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    headers: nominatimHeaders(),
  });
  if (!res.ok) throw new Error(`Reverse geocoding failed: ${res.status}`);
  return res.json() as Promise<NominatimReverseResult>;
}

// ── Types ──────────────────────────────────────────────────────────────────────

export interface NominatimAddress {
  road?: string;
  house_number?: string;
  postcode?: string;
  city?: string;
  town?: string;
  village?: string;
  suburb?: string;
  city_district?: string;
  borough?: string;
  neighbourhood?: string;
  hamlet?: string;
}

export interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
  address: NominatimAddress;
}

export interface NominatimReverseResult {
  display_name?: string;
  lat?: string;
  lon?: string;
  address: NominatimAddress;
}

// ── Address formatting ────────────────────────────────────────────────────────

/**
 * Build a human-readable, complete address string from Nominatim's structured
 * fields. Falls back to the raw display_name (or the lat/lon string) when
 * fields are missing.
 *
 * Example output:
 *   "Lupinenweg 25, 89233 Neu-Ulm, Pfuhl"
 *   "Augsburger Straße 15, 89231 Neu-Ulm, Innenstadt"
 *   "Hengstweg 4, 89233 Neu-Ulm, Ludwigsfeld"
 *
 * Why not just `display_name`? Nominatim's display_name is verbose
 * ("Lupinenweg 25, Pfuhl, Neu-Ulm, Schwaben, 89233, Bayern, Deutschland") and
 * varies by language. The structured fields produce a consistent result
 * tailored to a German civic address.
 */
export function formatNominatimAddress(
  address: NominatimAddress | undefined,
  displayName?: string
): string {
  if (address) {
    const street = [address.road, address.house_number].filter(Boolean).join(" ");
    const city   = address.city ?? address.town ?? address.village ?? "";
    const postcode = address.postcode ?? "";
    const cityLine = [postcode, city].filter(Boolean).join(" ").trim();
    const stadtteil =
      address.suburb ??
      address.city_district ??
      address.borough ??
      address.neighbourhood ??
      address.hamlet ??
      "";
    const parts = [street, cityLine, stadtteil].filter((p) => p && p.length > 0);
    if (parts.length >= 2) return parts.join(", ");
  }

  // Fallback: trim Nominatim's verbose display_name to street + Stadtteil + city + postcode.
  if (displayName) {
    return displayName
      .split(",")
      .map((s) => s.trim())
      .filter(
        (s) =>
          s &&
          !/^Deutschland$/i.test(s) &&
          !/^Germany$/i.test(s) &&
          !/^Bayern$/i.test(s) &&
          !/^Bavaria$/i.test(s) &&
          !/^Schwaben$/i.test(s) &&
          !/^Swabia$/i.test(s) &&
          !/^Landkreis Neu-Ulm$/i.test(s)
      )
      .join(", ");
  }
  return "";
}

export { isWithinNeuUlm };

/**
 * Detect strings that are just a "lat, lon" pair (with or without decimals).
 * Used to suppress coordinate-only labels in the address search field, so
 * users always see/type human-readable text on every platform.
 */
export function looksLikeCoordinates(s: string | undefined | null): boolean {
  if (!s) return false;
  return /^-?\d{1,3}\.\d+\s*,\s*-?\d{1,3}\.\d+$/.test(s.trim());
}
