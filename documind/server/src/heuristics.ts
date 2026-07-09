// Local, offline document understanding — a dependency-free fallback for when
// no model is configured or the AI gateway is unreachable. It won't match a
// vision-LLM's nuance, but it makes the core promise work end-to-end with zero
// network: extract deadlines, costs, payments and critical items from German /
// English bureaucratic text, highlight them, build a small knowledge graph, and
// answer questions from that graph WITH sources.
//
// Everything here is pure and deterministic, so it is fully unit-testable.

import type { DocAnalysis, Entity, Highlight, HighlightType, Relation, Severity } from "./ai";
import { extractAmount, toIsoDate } from "./ai";

// ── Lexicons (lowercase; matched case-insensitively) ─────────────────────────

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  Finance: ["rechnung", "invoice", "betrag", "zahlung", "payment", "konto", "iban", "überweisung", "mahnung", "gebühr", "kontostand"],
  Insurance: ["versicherung", "insurance", "police", "policy", "beitrag", "schaden", "deckung", "tarif", "haftpflicht"],
  Utilities: ["strom", "gas", "wasser", "stadtwerke", "energie", "electricity", "utility", "abschlag", "zählerstand", "verbrauch"],
  Government: ["amt", "behörde", "bescheid", "finanzamt", "steuer", "tax", "bürgeramt", "antrag", "aktenzeichen", "government", "ordnungsamt"],
  Medical: ["arzt", "praxis", "rezept", "diagnose", "medical", "hospital", "krankenhaus", "patient", "befund", "apotheke"],
  Legal: ["vertrag", "contract", "kündigung", "anwalt", "gericht", "legal", "klage", "paragraph", "widerspruch", "frist"],
  Work: ["gehalt", "salary", "arbeitgeber", "employer", "lohn", "arbeitsvertrag", "personalnummer", "brutto", "netto"],
  Education: ["universität", "hochschule", "schule", "university", "school", "studium", "semester", "immatrikulation", "kit", "prüfung", "note"],
};

// Words that mark a due date / deadline near a date.
const DEADLINE_CUES = [
  "fällig", "fälligkeit", "frist", "bis zum", "bis spätestens", "spätestens", "zahlbar bis",
  "due", "deadline", "by the", "no later than", "pay by", "termin", "ablauf", "gültig bis",
  "innerhalb", "within", "bis ", " bis", "until",
];

// Words that mark a payment obligation near an amount.
const PAYMENT_CUES = [
  "betrag", "rechnungsbetrag", "zu zahlen", "zahlbetrag", "gesamtbetrag", "summe", "total",
  "amount due", "amount", "invoice total", "offener betrag", "forderung", "beitrag", "abschlag",
];

// Words that signal a critical consequence / urgent problem.
const CRITICAL_CUES = [
  "mahnung", "mahngebühr", "zahlungsverzug", "verzug", "kündigung", "sperrung", "sperre",
  "rechtliche schritte", "inkasso", "vollstreckung", "pfändung", "strafe", "bußgeld", "verzugszinsen",
  "penalty", "overdue", "legal action", "terminate", "suspend", "disconnect", "late fee", "final notice",
  "letzte mahnung", "einstellung der belieferung", "widerspruchsfrist", "ausschlussfrist",
];

// Words that signal a required action (not itself a payment/deadline).
const ACTION_CUES = [
  "bitte", "please", "senden sie", "reichen sie ein", "submit", "unterschreiben", "sign",
  "vereinbaren sie", "kontaktieren", "contact", "melden sie", "return", "bestätigen", "confirm",
  "vorlegen", "einreichen", "termin vereinbaren", "antwort", "reply",
];

/** Fold German umlauts to ASCII (ä→ae …) so cues match text whether or not the
 * document (or its OCR) preserved umlauts — "fällig" and "faellig" both hit. */
export function deumlaut(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss");
}

function includesAny(haystack: string, needles: string[]): string | undefined {
  const low = deumlaut(haystack);
  for (const n of needles) if (low.includes(deumlaut(n))) return n;
  return undefined;
}

/** Split raw text into trimmed, meaningful lines / sentences for scanning. */
export function segments(text: string): string[] {
  return text
    .split(/\n+|(?<=[.!?])\s+(?=[A-ZÄÖÜ0-9])/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 0);
}

// ── Date extraction incl. relative German/English phrasing ───────────────────

/** Every ISO-resolvable date in a piece of text (absolute or relative). */
export function extractDates(text: string, today = new Date()): string[] {
  const out: string[] = [];

  // ISO: YYYY-MM-DD (handled first so the day-first pass can't corrupt it).
  for (const m of text.match(/\b\d{4}-\d{2}-\d{2}\b/g) || []) {
    const iso = toIsoDate(m);
    if (iso) out.push(iso);
  }

  // Day-first European: DD.MM.YYYY / DD.MM.YY (also / and - separators).
  for (const m of text.matchAll(/\b(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4}|\d{2})\b/g)) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    const iso = toIsoDate(`${m[1]}.${m[2]}.${year}`);
    if (iso) out.push(iso);
  }

  // Relative: "innerhalb von 14 Tagen", "within 14 days", "in 30 Tagen".
  const rel = text.matchAll(/\b(?:innerhalb\s+von\s+|within\s+|in\s+)(\d{1,3})\s*(tag|tage|tagen|day|days|woche|wochen|week|weeks)\b/gi);
  for (const m of rel) {
    const n = parseInt(m[1], 10);
    const unit = m[2].toLowerCase();
    const days = unit.startsWith("woche") || unit.startsWith("week") ? n * 7 : n;
    const d = new Date(today.getTime());
    d.setDate(d.getDate() + days);
    out.push(d.toISOString().slice(0, 10));
  }

  return [...new Set(out)];
}

// ── Category ─────────────────────────────────────────────────────────────────

// Finance shares vocabulary with almost every bill (Rechnung, Betrag, Konto),
// so it's the generic money fallback: a specialized category (a utility, an
// insurer, an authority…) wins whenever it has any keyword hit at all.
const SPECIALIZED = ["Insurance", "Utilities", "Government", "Medical", "Legal", "Work", "Education"];

export function classify(text: string): string {
  const low = deumlaut(text);
  const score = (cat: string): number =>
    CATEGORY_KEYWORDS[cat].reduce((n, w) => n + (low.split(deumlaut(w)).length - 1), 0);

  let best = "";
  let bestScore = 0;
  for (const cat of SPECIALIZED) {
    const s = score(cat);
    if (s > bestScore) {
      bestScore = s;
      best = cat;
    }
  }
  if (best) return best;
  return score("Finance") > 0 ? "Finance" : "Other";
}

// ── Title & summary ──────────────────────────────────────────────────────────

function guessTitle(segs: string[]): string {
  // Prefer a short, meaningful early line (sender/subject) over a date or number.
  for (const s of segs.slice(0, 6)) {
    if (s.length >= 4 && s.length <= 80 && /[A-Za-zÄÖÜäöü]/.test(s) && !/^\d/.test(s)) {
      return s;
    }
  }
  return segs[0]?.slice(0, 80) || "Untitled document";
}

function severityFor(type: HighlightType, seg: string, today: Date, date?: string): Severity {
  if (type === "critical") return includesAny(seg, ["letzte mahnung", "final notice", "vollstreckung", "pfändung", "inkasso"]) ? "high" : "medium";
  if (date) {
    const days = (new Date(date).getTime() - today.getTime()) / 86_400_000;
    if (days < 0) return "high"; // overdue
    if (days <= 7) return "high";
    if (days <= 30) return "medium";
  }
  return type === "deadline" || type === "payment" ? "medium" : "low";
}

// ── The analyzer ─────────────────────────────────────────────────────────────

let counter = 0;
function makeHighlight(type: HighlightType, text: string, severity: Severity, date?: string, amount?: string): Highlight {
  return { id: `hl${Date.now().toString(36)}${counter++}`, type, text, date, amount, severity };
}

const DEDUP_LANG_DE = /[äöüß]|\b(und|der|die|das|nicht|Rechnung|Betrag|fällig|Frist)\b/i;

export function heuristicAnalyze(rawText: string, today = new Date()): DocAnalysis {
  const text = (rawText || "").trim();
  const segs = segments(text);
  const highlights: Highlight[] = [];
  const seenDeadline = new Set<string>();

  for (const seg of segs) {
    const dates = extractDates(seg, today);
    const amount = extractAmount(seg);
    const hasDeadlineCue = includesAny(seg, DEADLINE_CUES);
    const hasPaymentCue = includesAny(seg, PAYMENT_CUES);
    const criticalCue = includesAny(seg, CRITICAL_CUES);
    const actionCue = includesAny(seg, ACTION_CUES);

    // Deadline: a date with a due/deadline cue.
    if (dates.length && hasDeadlineCue) {
      for (const d of dates) {
        if (seenDeadline.has(d)) continue;
        seenDeadline.add(d);
        highlights.push(makeHighlight("deadline", trimSeg(seg), severityFor("deadline", seg, today, d), d, amount));
      }
    }

    // Payment: an amount with a payment cue (or an amount + a date on an invoice line).
    if (amount && (hasPaymentCue || (dates.length && !hasDeadlineCue))) {
      highlights.push(makeHighlight("payment", trimSeg(seg), severityFor("payment", seg, today, dates[0]), dates[0], amount));
    }

    // Critical: an explicit consequence keyword.
    if (criticalCue) {
      highlights.push(makeHighlight("critical", trimSeg(seg), severityFor("critical", seg, today), dates[0], amount));
    }

    // Action: a request cue with no payment/deadline already captured on this line.
    if (actionCue && !hasDeadlineCue && !hasPaymentCue && !criticalCue && !amount) {
      highlights.push(makeHighlight("action", trimSeg(seg), "low"));
    }
  }

  const entities = extractEntities(text, highlights);
  const relations = buildRelations(entities, highlights);
  const category = classify(text);

  return {
    title: guessTitle(segs),
    category,
    summary: summarize(segs, highlights, category),
    language: DEDUP_LANG_DE.test(text) ? "German" : "English",
    fullText: text,
    highlights: dedupeHighlights(highlights),
    entities,
    relations,
  };
}

function trimSeg(seg: string): string {
  return seg.length > 160 ? seg.slice(0, 157) + "…" : seg;
}

function dedupeHighlights(hs: Highlight[]): Highlight[] {
  const seen = new Set<string>();
  const out: Highlight[] = [];
  for (const h of hs) {
    const key = `${h.type}|${h.date ?? ""}|${h.amount ?? ""}|${h.text.slice(0, 40)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(h);
  }
  // Surface the most urgent first.
  const rank: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

function summarize(segs: string[], highlights: Highlight[], category: string): string {
  const parts: string[] = [];
  const pay = highlights.find((h) => h.type === "payment" && h.amount);
  const due = highlights.find((h) => h.type === "deadline" && h.date);
  const crit = highlights.find((h) => h.type === "critical");
  if (pay) parts.push(`Amount ${pay.amount}${due ? ` due ${due.date}` : ""}`);
  else if (due) parts.push(`Deadline ${due.date}`);
  if (crit) parts.push("contains a critical notice");
  const head = `${category} document`;
  return parts.length ? `${head}: ${parts.join("; ")}.` : `${head}. ${segs[0]?.slice(0, 120) ?? ""}`.trim();
}

// ── Knowledge graph ──────────────────────────────────────────────────────────

const ORG_SUFFIX = /\b[A-ZÄÖÜ][\wäöüß.&-]*(?:\s+[A-ZÄÖÜ][\wäöüß.&-]*)*\s+(GmbH|AG|KG|e\.?V\.?|mbH|Inc\.?|Ltd\.?|Stadtwerke|Versicherung|Bank|Krankenkasse|Finanzamt|Amt|Universität|Hochschule)\b/g;

export function extractEntities(text: string, highlights: Highlight[]): Entity[] {
  const map = new Map<string, Entity>();
  const add = (name: string, type: string) => {
    const n = name.trim();
    if (n.length < 2) return;
    const key = n.toLowerCase();
    if (!map.has(key)) map.set(key, { name: n, type });
  };

  // Organizations by legal-form / institution suffix.
  for (const m of text.matchAll(ORG_SUFFIX)) add(m[0].trim(), "organization");

  // "Stadtwerke Neu-Ulm" style leading institution even without a suffix match.
  const inst = text.match(/\b(Stadtwerke|Finanzamt|Amtsgericht|Krankenkasse|Bürgeramt)\s+[A-ZÄÖÜ][\wäöüß-]+/g) || [];
  for (const i of inst) add(i, "organization");

  // Reference / invoice / customer numbers.
  const refs = text.match(/\b(?:Rechnungsnummer|Rechnungs-Nr\.?|Invoice|Kundennummer|Aktenzeichen|Az\.?|Vertragsnummer)[:\s]*[A-Z0-9][A-Z0-9\/-]{2,}/gi) || [];
  for (const r of refs) add(r.replace(/\s+/g, " ").trim(), "reference");

  // IBANs.
  const ibans = text.match(/\b[A-Z]{2}\d{2}[\s]?(?:\d{4}\s?){3,7}\d{0,4}\b/g) || [];
  for (const i of ibans) add(i.replace(/\s+/g, " ").trim(), "account");

  // Dates & amounts from highlights become graph nodes too.
  for (const h of highlights) {
    if (h.date) add(h.date, "date");
    if (h.amount) add(h.amount, "amount");
  }

  return [...map.values()].slice(0, 24);
}

function buildRelations(entities: Entity[], highlights: Highlight[]): Relation[] {
  const org = entities.find((e) => e.type === "organization");
  const rels: Relation[] = [];
  if (!org) return rels;
  for (const h of highlights) {
    if (h.type === "payment" && h.amount) rels.push({ from: org.name, to: h.amount, label: "owes" });
    if (h.type === "deadline" && h.date) rels.push({ from: org.name, to: h.date, label: "due" });
  }
  // Link the reference number to the org.
  const ref = entities.find((e) => e.type === "reference");
  if (ref) rels.push({ from: org.name, to: ref.name, label: "reference" });
  return rels.slice(0, 16);
}

// ── Offline extractive answerer ──────────────────────────────────────────────

/**
 * Answer a question WITHOUT a model by drawing on the FACTS sheet (knowledge
 * graph) and the retrieved EXCERPTS. Deterministic, grounded, and always cites
 * — it can't reason freely, but it never invents facts.
 */
export function heuristicAnswer(
  question: string,
  facts: string,
  contexts: { title: string; text: string }[],
): string {
  const q = question.toLowerCase();
  const factLines = facts.split("\n").map((l) => l.trim()).filter(Boolean);

  const wantsMoney = /(owe|owed|cost|pay|payment|amount|betrag|zahle|kosten|schulde|rechnung|money|total)/.test(q);
  const wantsDeadline = /(deadline|due|fällig|frist|when|wann|termin|expire|ablauf)/.test(q);
  const wantsCritical = /(critical|urgent|problem|issue|wichtig|dringend|mahnung|risk|warn)/.test(q);

  const pick = (needle: RegExp) => factLines.filter((l) => needle.test(l.toLowerCase()));

  let picked: string[] = [];
  if (wantsMoney) picked = pick(/pay|owe|betrag|amount|€|eur|chf|\$/);
  else if (wantsDeadline) picked = pick(/due|deadline|fällig|frist|\d{4}-\d{2}-\d{2}/);
  else if (wantsCritical) picked = pick(/critical|urgent|mahnung|penalty|overdue|verzug/);

  const lines: string[] = [];
  if (picked.length) {
    lines.push(picked.slice(0, 12).join("\n"));
  } else if (factLines.length) {
    // General question — summarize the whole facts sheet.
    lines.push(factLines.slice(0, 14).join("\n"));
  }

  // Ground with the single most relevant excerpt + its source.
  if (contexts.length) {
    const best = rankContext(question, contexts);
    if (best) {
      const snippet = best.text.replace(/\s+/g, " ").slice(0, 320).trim();
      lines.push(`\nFrom “${best.title}”: ${snippet}${best.text.length > 320 ? "…" : ""}`);
    }
  }

  if (!lines.length) {
    return "I don't have anything in your documents that answers that yet. Scan or import a document and ask again.";
  }

  const header = wantsMoney
    ? "Here's what you owe across your documents:"
    : wantsDeadline
      ? "Here are the deadlines I found:"
      : wantsCritical
        ? "Here are the items that need attention:"
        : "Here's what your documents say:";

  return `${header}\n\n${lines.join("\n").trim()}\n\n(Offline mode — answered from your knowledge graph. Connect a model in Settings for richer answers.)`;
}

function rankContext(question: string, contexts: { title: string; text: string }[]) {
  const qWords = new Set(
    question.toLowerCase().split(/\W+/).filter((w) => w.length > 2),
  );
  let best: { title: string; text: string } | null = null;
  let bestScore = -1;
  for (const c of contexts) {
    const low = (c.title + " " + c.text).toLowerCase();
    let score = 0;
    for (const w of qWords) if (low.includes(w)) score++;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}
