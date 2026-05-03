/**
 * lib/districtDetector.ts
 *
 * Two complementary ways to detect the Abfuhrbezirk (1-8) for an address:
 *
 *   1. detectDistrictFromCoordinates(lat, lon) — finds the geographically
 *      nearest Stadtteil from `STADTTEILE` and returns its bezirk. Always
 *      returns a value for any reasonable Neu-Ulm coordinate.
 *
 *   2. detectDistrictFromAddress(addressFields, lat?, lon?) — matches one of
 *      the Nominatim address fields (suburb, neighbourhood, hamlet, …) by
 *      Stadtteil name. Falls back to coordinates when no name match is found.
 *
 * Special case for Pfuhl: Nominatim usually returns just "Pfuhl" without
 * Nord/Süd. We disambiguate with latitude — south of 48.420° is Pfuhl-Süd
 * (Bezirk 3), north of 48.420° is Pfuhl-Nord (Bezirk 5).
 */
import {
  STADTTEILE,
  findStadtteilByName,
  nearestStadtteil,
  haversineMeters,
  Stadtteil,
} from "./stadtteile";
import type { NominatimAddress } from "./dataFetcher";

/** Pfuhl latitude split: Nord above, Süd below. */
const PFUHL_LAT_SPLIT = 48.420;

/**
 * Resolve a coordinate to its Bezirk.
 * Returns null only for clearly out-of-region coordinates (far outside the
 * Neu-Ulm centroid cluster).
 */
export function detectDistrictFromCoordinates(
  lat: number,
  lon: number
): number | null {
  if (!isFinite(lat) || !isFinite(lon)) return null;

  const nearest = nearestStadtteil(lat, lon);
  const dist = haversineMeters({ lat, lon }, nearest.center);

  // Sanity bound: if the nearest Stadtteil centroid is more than 6 km away,
  // the user is probably outside Neu-Ulm. Caller can show a warning.
  if (dist > 6_000) return null;

  return resolvePfuhl(nearest, lat);
}

/**
 * Resolve a Stadtteil name match (with optional coordinates for tie-breaking).
 * Used after a Nominatim search/reverse lookup.
 */
export function detectDistrictFromAddress(
  address: NominatimAddress | undefined,
  lat?: number,
  lon?: number
): number | null {
  // Try the most specific fields first.
  const candidateNames = [
    address?.suburb,
    address?.city_district,
    address?.borough,
    address?.neighbourhood,
    address?.hamlet,
  ].filter((x): x is string => Boolean(x));

  for (const name of candidateNames) {
    const st = findStadtteilByName(name);
    if (st) {
      return resolvePfuhl(st, lat);
    }
  }

  // Fallback to coordinates if provided.
  if (lat !== undefined && lon !== undefined) {
    return detectDistrictFromCoordinates(lat, lon);
  }
  return null;
}

/** Disambiguate Pfuhl-Nord (Bezirk 5) vs Pfuhl-Süd (Bezirk 3) by latitude. */
function resolvePfuhl(st: Stadtteil, lat?: number): number {
  if (st.name !== "Pfuhl-Nord" && st.name !== "Pfuhl-Süd") return st.bezirk;
  // If we don't have lat, default to whatever the Stadtteil already says.
  if (lat === undefined) return st.bezirk;
  return lat >= PFUHL_LAT_SPLIT ? 5 /* Pfuhl-Nord */ : 3 /* Pfuhl-Süd */;
}

/** Re-exported for tests. */
export { STADTTEILE, findStadtteilByName, nearestStadtteil };
