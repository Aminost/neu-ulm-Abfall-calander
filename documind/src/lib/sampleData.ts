// Realistic sample documents so the whole app can be experienced end-to-end
// without scanning or an AI key: Library, highlights, dashboard, search,
// knowledge graph and deadline alerts all populate immediately. Chat also works
// on these once they're pushed to a running backend.
//
// Stable IDs make loading idempotent (re-loading replaces rather than duplicates).

import type { DocumentRecord } from "./types";

function daysFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export function sampleDocuments(): DocumentRecord[] {
  const now = Date.now();
  return [
    {
      id: "sample-stadtwerke",
      createdAt: now - 1000 * 60 * 60 * 24 * 2,
      status: "ready",
      analysis: {
        title: "Stadtwerke Neu-Ulm — Stromrechnung",
        category: "Utilities",
        language: "German",
        summary: "Annual electricity bill of €149.90, due in about a month; late payment adds fees.",
        fullText:
          "Stadtwerke Neu-Ulm GmbH. Rechnung Nr. 2026-33821. Kundennummer 55123. " +
          "Jahresabrechnung Strom. Offener Betrag: 149,90 EUR. Fällig am " +
          daysFromNow(37).split("-").reverse().join(".") +
          ". Bei Zahlungsverzug fallen Mahngebühren in Höhe von 5,00 EUR an und die Belieferung kann eingestellt werden.",
        highlights: [
          { id: "s1a", type: "payment", text: "Electricity bill", amount: "149,90 EUR", severity: "high" },
          { id: "s1b", type: "deadline", text: "Pay the electricity invoice", date: daysFromNow(37), severity: "high" },
          { id: "s1c", type: "critical", text: "Supply may be cut off if unpaid; €5 late fee", severity: "medium" },
        ],
        entities: [
          { name: "Stadtwerke Neu-Ulm", type: "organization" },
          { name: "55123", type: "account" },
          { name: "Rechnung 2026-33821", type: "invoice" },
        ],
        relations: [
          { from: "55123", to: "Stadtwerke Neu-Ulm", label: "account at" },
          { from: "Rechnung 2026-33821", to: "55123", label: "billed to" },
        ],
      },
    },
    {
      id: "sample-krankenkasse",
      createdAt: now - 1000 * 60 * 60 * 24 * 1,
      status: "ready",
      analysis: {
        title: "AOK — Nachweis erforderlich",
        category: "Insurance",
        language: "German",
        summary: "Health insurer requests a proof-of-income form; must be returned within two weeks.",
        fullText:
          "AOK Baden-Württemberg. Sehr geehrte Frau Guedria, für die Fortführung Ihrer " +
          "Familienversicherung benötigen wir einen Einkommensnachweis. Bitte senden Sie das " +
          "beiliegende Formular bis zum " + daysFromNow(16).split("-").reverse().join(".") +
          " zurück. Andernfalls kann die beitragsfreie Versicherung nicht fortgeführt werden.",
        highlights: [
          { id: "s2a", type: "deadline", text: "Return the proof-of-income form", date: daysFromNow(16), severity: "high" },
          { id: "s2b", type: "action", text: "Fill in and send the enclosed income form", severity: "high" },
          { id: "s2c", type: "critical", text: "Free family insurance ends if the form is not returned", severity: "high" },
        ],
        entities: [
          { name: "AOK Baden-Württemberg", type: "organization" },
          { name: "Familienversicherung", type: "policy" },
        ],
        relations: [{ from: "Familienversicherung", to: "AOK Baden-Württemberg", label: "held with" }],
      },
    },
    {
      id: "sample-bussgeld",
      createdAt: now - 1000 * 60 * 60 * 12,
      status: "ready",
      analysis: {
        title: "Bußgeldbescheid — Stadt Neu-Ulm",
        category: "Government",
        language: "German",
        summary: "Parking fine of €60, payable within two weeks; objection possible in the same period.",
        fullText:
          "Stadt Neu-Ulm, Bußgeldstelle. Bußgeldbescheid wegen Parkverstoß. Geldbuße: 60,00 EUR. " +
          "Zahlbar bis " + daysFromNow(11).split("-").reverse().join(".") +
          ". Innerhalb dieser Frist können Sie Einspruch einlegen. Nach Ablauf wird der Betrag vollstreckt.",
        highlights: [
          { id: "s3a", type: "payment", text: "Parking fine", amount: "60,00 EUR", severity: "high" },
          { id: "s3b", type: "deadline", text: "Pay the fine or file an objection", date: daysFromNow(11), severity: "high" },
          { id: "s3c", type: "critical", text: "Enforcement after the deadline; objection window closes", severity: "high" },
          { id: "s3d", type: "action", text: "Decide whether to pay or object", severity: "medium" },
        ],
        entities: [
          { name: "Stadt Neu-Ulm", type: "organization" },
          { name: "Bußgeldbescheid", type: "document" },
        ],
        relations: [{ from: "Bußgeldbescheid", to: "Stadt Neu-Ulm", label: "issued by" }],
      },
    },
  ];
}
