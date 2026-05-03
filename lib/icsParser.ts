/**
 * lib/icsParser.ts
 *
 * Minimal RFC 5545 iCalendar parser tailored for Neu-Ulm waste-collection ICS
 * files. Handles only the subset of iCal we care about: VEVENT blocks with
 * DTSTART (date or date-time) and SUMMARY.
 *
 * Robustness features:
 *  - RFC 5545 line unfolding: continuation lines that start with space or tab
 *    are joined to the previous line BEFORE parsing.
 *  - DTSTART variants supported:
 *       DTSTART;VALUE=DATE:20260114
 *       DTSTART:20260114
 *       DTSTART:20260114T060000
 *       DTSTART:20260114T060000Z
 *       DTSTART;TZID=Europe/Berlin:20260114T060000
 *  - SUMMARY classification handles many German wording variants used by
 *    different city ICS exporters (Restmüll/Biotonne/Bioabfall/Gelber Sack/
 *    Wertstofftonne/Gelbe Tonne/Papiertonne/Altpapier/Grüngut/Bioabfall).
 *  - Unclassified events (e.g. holiday markers) are silently skipped.
 *  - Duplicate (date, type) pairs are de-duplicated.
 */

export type WasteType =
  | "Rest- & Biomüll"
  | "Grüngut"
  | "Papiertonne"
  | "Gelber Sack";

export interface CollectionEvent {
  id: string;
  date: Date;
  type: WasteType;
  summary: string;
}

/** Unfold continuation lines (RFC 5545 §3.1): a line that begins with a space
 *  or tab is a continuation of the previous logical line. */
function unfold(text: string): string[] {
  // Normalise line endings, then re-join continuation lines.
  const physical = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const logical: string[] = [];
  for (const line of physical) {
    if (line.length === 0) continue;
    if ((line.startsWith(" ") || line.startsWith("\t")) && logical.length > 0) {
      logical[logical.length - 1] += line.slice(1);
    } else {
      logical.push(line);
    }
  }
  return logical;
}

/** Decode iCal property text-escapes per RFC 5545 §3.3.11. */
function unescapeText(value: string): string {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

/** Parse a DTSTART value (everything after the colon). Returns local Date or null. */
function parseDateValue(value: string): Date | null {
  // Pure date: YYYYMMDD
  let m = value.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) {
    return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
  }
  // Date-time, optional Z (UTC). For waste pickups we only care about the
  // date portion — but we honour Z by converting to local-midnight of the
  // same day (the city ICS uses local Berlin date semantics).
  m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (m) {
    const [, y, mo, d] = m;
    return new Date(parseInt(y, 10), parseInt(mo, 10) - 1, parseInt(d, 10));
  }
  return null;
}

/** Map a SUMMARY string (any locale variant) to a canonical WasteType. */
function classifySummary(raw: string): WasteType | null {
  const s = raw.toLowerCase();

  // Skip non-pickup events the city sometimes ships in the same calendar:
  // "Wertstoffhof geschlossen", holidays, free Christmas-tree pickup, etc.
  if (
    s.includes("wertstoffhof") ||
    s.includes("geschlossen") ||
    s.includes("feiertag") ||
    s.includes("neujahr") ||
    s.includes("weihnach") ||
    s.includes("oster") ||
    s.includes("pfingst") ||
    s.includes("info") ||
    s.includes("hinweis")
  ) {
    return null;
  }

  // Order matters: check Bio first because "Restmüll & Biotonne" should match Rest-& Biomüll, not Bio alone.
  if (
    s.includes("rest") ||
    s.includes("biomüll") ||
    s.includes("biomuell") ||
    s.includes("bioabfall") ||
    s.includes("biotonne") ||
    s.includes("bio-") ||
    /\bbio\b/.test(s) ||
    s.includes("hausmüll") ||
    s.includes("hausmuell")
  ) {
    return "Rest- & Biomüll";
  }

  if (
    s.includes("grüngut") ||
    s.includes("gruengut") ||
    s.includes("grünschnitt") ||
    s.includes("gartenabfall") ||
    s.includes("braun")
  ) {
    return "Grüngut";
  }

  if (
    s.includes("papier") ||
    s.includes("altpapier") ||
    s.includes("blau") ||
    s.includes("kartonage")
  ) {
    return "Papiertonne";
  }

  if (
    s.includes("gelb") ||             // Gelber Sack / Gelbe Tonne
    s.includes("wertstofftonne") ||   // Wertstofftonne (NOT "Wertstoffhof")
    s.includes("wertstoffsack") ||
    /\bgs\b/.test(s) ||               // city ICS sometimes abbreviates
    s.includes("verpackung")          // Verpackungsabfall
  ) {
    return "Gelber Sack";
  }

  return null;
}

/**
 * Parse an iCalendar string into sorted, classified, deduplicated events.
 * Throws nothing; on malformed input returns an empty array (callers may log).
 */
export function parseICS(icsData: string): CollectionEvent[] {
  if (!icsData || !icsData.includes("BEGIN:VCALENDAR")) return [];

  const lines = unfold(icsData);
  const events: CollectionEvent[] = [];

  // Use a Set to dedupe (date+type)
  const seen = new Set<string>();

  let inEvent = false;
  let date: Date | null = null;
  let type: WasteType | null = null;
  let summary = "";

  for (const line of lines) {
    if (line.startsWith("BEGIN:VEVENT")) {
      inEvent = true;
      date = null;
      type = null;
      summary = "";
      continue;
    }

    if (line.startsWith("END:VEVENT")) {
      if (inEvent && date && type) {
        const key = `${date.toISOString().slice(0, 10)}|${type}`;
        if (!seen.has(key)) {
          seen.add(key);
          events.push({
            id: "", // assigned after sort
            date,
            type,
            summary,
          });
        }
      }
      inEvent = false;
      continue;
    }

    if (!inEvent) continue;

    // RFC 5545 property line: NAME[;params]:VALUE
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const propPart = line.slice(0, colonIdx);
    const valuePart = line.slice(colonIdx + 1);
    const propName = propPart.split(";")[0].toUpperCase();

    if (propName === "DTSTART") {
      date = parseDateValue(valuePart.trim());
    } else if (propName === "SUMMARY") {
      summary = unescapeText(valuePart).trim();
      type = classifySummary(summary);
    }
  }

  // Sort ascending by date, then assign deterministic IDs.
  return events
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .map((e, i) => ({
      ...e,
      id: `${e.date.toISOString().slice(0, 10)}-${e.type}-${i}`,
    }));
}
