/**
 * lib/stadtteile.ts
 *
 * Authoritative mapping of Neu-Ulm Stadtteile (urban districts) to Abfuhrbezirke
 * (waste-collection zones), as published in the official Stadt Neu-Ulm
 * Abfallkalender 2026.
 *
 * Each Stadtteil has:
 *   - name      — the canonical German name
 *   - bezirk    — the waste collection district (1-8)
 *   - center    — approximate centroid (lat, lon) in WGS-84, used for
 *                 nearest-Stadtteil detection from GPS coordinates.
 *   - aliases   — additional names used by Nominatim's `suburb`,
 *                 `city_district`, `neighbourhood`, or `hamlet` fields.
 *
 * Detection priority used by districtDetector:
 *   1. Match Stadtteil name (canonical or alias) against any Nominatim address
 *      field. Most reliable for street-level matches.
 *   2. Failing that, find the geographically nearest Stadtteil by centroid.
 *      Sufficient for any point inside the city.
 *
 * Centroid coordinates were taken from the Stadt Neu-Ulm Stadtteilliste and
 * cross-referenced with the Abfallkalender 2026 boundaries (PDF, page 3).
 */

export interface Stadtteil {
  name: string;
  bezirk: number;
  center: { lat: number; lon: number };
  aliases?: string[];
}

/** All Stadtteile of Neu-Ulm, with their assigned Abfuhrbezirk (2026). */
export const STADTTEILE: Stadtteil[] = [
  // ── Bezirk 1 — Mo (gerade Woche) — Neu-Ulm-West, Vorfeld, Neu-Ulm-Mitte, Illerbrücke
  {
    name: "Neu-Ulm-West",
    bezirk: 1,
    center: { lat: 48.3955, lon: 9.972 },
    aliases: ["West", "Neu-Ulm West"],
  },
  {
    name: "Vorfeld",
    bezirk: 1,
    center: { lat: 48.398, lon: 9.985 },
  },
  {
    name: "Neu-Ulm-Mitte",
    bezirk: 1,
    center: { lat: 48.394, lon: 9.998 },
    aliases: ["Mitte", "Neu-Ulm Mitte"],
  },
  {
    name: "Illerbrücke",
    bezirk: 1,
    center: { lat: 48.388, lon: 9.978 },
    aliases: ["Iller-Brücke", "Illerbruecke"],
  },

  // ── Bezirk 2 — Mo (ungerade Woche) — Neu-Ulm-Innenstadt
  {
    name: "Neu-Ulm-Innenstadt",
    bezirk: 2,
    center: { lat: 48.394, lon: 10.005 },
    aliases: ["Innenstadt", "Neu-Ulm Innenstadt", "Stadtmitte"],
  },

  // ── Bezirk 3 — Di (gerade Woche) — Wiley-Süd, Schwaighofen, Pfuhl-Süd, Finningen
  {
    name: "Wiley-Süd",
    bezirk: 3,
    center: { lat: 48.4015, lon: 10.025 },
    aliases: ["Wiley Süd", "Wiley-Sud", "Wiley South"],
  },
  {
    name: "Schwaighofen",
    bezirk: 3,
    center: { lat: 48.378, lon: 10.038 },
    aliases: ["Schlüsselhof", "Schluesselhof", "Schützenheim", "Schuetzenheim"],
  },
  {
    name: "Pfuhl-Süd",
    bezirk: 3,
    center: { lat: 48.413, lon: 10.020 },
    aliases: ["Pfuhl Süd", "Pfuhl-Sud", "Pfuhl South"],
  },
  {
    name: "Finningen",
    bezirk: 3,
    center: { lat: 48.376, lon: 10.058 },
    aliases: ["Breitenhof"],
  },

  // ── Bezirk 4 — Di (ungerade Woche) — Innenstadt-Ost, Offenhausen
  {
    name: "Innenstadt-Ost",
    bezirk: 4,
    center: { lat: 48.394, lon: 10.020 },
    aliases: ["Innenstadt Ost"],
  },
  {
    name: "Offenhausen",
    bezirk: 4,
    center: { lat: 48.388, lon: 10.026 },
  },

  // ── Bezirk 5 — Mi (gerade Woche) — Pfuhl-Nord
  {
    name: "Pfuhl-Nord",
    bezirk: 5,
    center: { lat: 48.4295, lon: 10.025 },
    aliases: [
      "Pfuhl Nord",
      "Pfuhl-Nord",
      "Pfuhl North",
      "Striebelhof",
      "Schulzentrum",
      // Bare "Pfuhl" defaults to Pfuhl-Nord; if Nominatim returns just "Pfuhl"
      // for an address whose latitude is below 48.420 we re-route to Bezirk 3
      // (Pfuhl-Süd) inside districtDetector.
      "Pfuhl",
    ],
  },

  // ── Bezirk 6 — Mi (ungerade Woche) — Gerlenhofen, Hausen, Jedelhausen, Reutti, Holzschwang
  {
    name: "Gerlenhofen",
    bezirk: 6,
    center: { lat: 48.353, lon: 9.985 },
    aliases: ["Harzerhof", "Gurrenhof", "Häuserhof", "Haeuserhof", "Werzlen"],
  },
  {
    name: "Hausen",
    bezirk: 6,
    center: { lat: 48.349, lon: 10.045 },
  },
  {
    name: "Jedelhausen",
    bezirk: 6,
    center: { lat: 48.355, lon: 10.052 },
  },
  {
    name: "Reutti",
    bezirk: 6,
    center: { lat: 48.345, lon: 10.030 },
    aliases: ["Marbach"],
  },
  {
    name: "Holzschwang",
    bezirk: 6,
    center: { lat: 48.325, lon: 10.025 },
    aliases: ["Tiefenbach", "Neubronn", "Weiler"],
  },

  // ── Bezirk 7 — Do (gerade Woche) — Burlafingen, Steinheim
  {
    name: "Burlafingen",
    bezirk: 7,
    center: { lat: 48.408, lon: 10.085 },
  },
  {
    name: "Steinheim",
    bezirk: 7,
    center: { lat: 48.378, lon: 10.090 },
  },

  // ── Bezirk 8 — Do (ungerade Woche) — Ludwigsfeld
  {
    name: "Ludwigsfeld",
    bezirk: 8,
    center: { lat: 48.434, lon: 10.135 },
    aliases: ["Riedwirtshaus", "Brunnenweg"],
  },
];

/** Build a normalised lookup table for fast name matching. */
const NAME_INDEX: Map<string, Stadtteil> = (() => {
  const map = new Map<string, Stadtteil>();
  for (const s of STADTTEILE) {
    map.set(normaliseName(s.name), s);
    if (s.aliases) {
      for (const a of s.aliases) map.set(normaliseName(a), s);
    }
  }
  return map;
})();

/** Lower-case, strip punctuation/whitespace for forgiving matches. */
export function normaliseName(s: string): string {
  return s
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/[\s\-_./]+/g, "");
}

/**
 * Look up a Stadtteil by name (canonical or alias). Returns the first match,
 * or null if no match. Forgiving to case, hyphenation, and umlaut variants.
 */
export function findStadtteilByName(name: string | undefined | null): Stadtteil | null {
  if (!name) return null;
  return NAME_INDEX.get(normaliseName(name)) ?? null;
}

/** Haversine distance in metres between two coordinates. */
export function haversineMeters(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number }
): number {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Return the Stadtteil whose centroid is closest to the given point.
 * Used as a robust geographic fallback when no name match is available.
 */
export function nearestStadtteil(lat: number, lon: number): Stadtteil {
  let best = STADTTEILE[0];
  let bestDist = Infinity;
  for (const s of STADTTEILE) {
    const d = haversineMeters({ lat, lon }, s.center);
    if (d < bestDist) {
      bestDist = d;
      best = s;
    }
  }
  return best;
}

/** Bezirk metadata: weekday + week-parity from the official 2026 calendar. */
export const BEZIRK_INFO: Record<number, { weekday: string; parity: string; areas: string }> = {
  1: { weekday: "Montag",     parity: "gerade",   areas: "Neu-Ulm-West, Vorfeld, Neu-Ulm-Mitte, Illerbrücke" },
  2: { weekday: "Montag",     parity: "ungerade", areas: "Neu-Ulm-Innenstadt" },
  3: { weekday: "Dienstag",   parity: "gerade",   areas: "Wiley-Süd, Schwaighofen, Pfuhl-Süd, Finningen" },
  4: { weekday: "Dienstag",   parity: "ungerade", areas: "Innenstadt-Ost, Offenhausen" },
  5: { weekday: "Mittwoch",   parity: "gerade",   areas: "Pfuhl-Nord" },
  6: { weekday: "Mittwoch",   parity: "ungerade", areas: "Gerlenhofen, Hausen, Jedelhausen, Reutti, Holzschwang" },
  7: { weekday: "Donnerstag", parity: "gerade",   areas: "Burlafingen, Steinheim" },
  8: { weekday: "Donnerstag", parity: "ungerade", areas: "Ludwigsfeld" },
};
