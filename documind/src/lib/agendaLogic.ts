// Pure, framework-agnostic logic for the Agenda and Library dashboard. Kept free
// of React Native imports so it can be unit-tested directly (see agendaLogic.test.ts).

import type { DocumentRecord, Severity } from "./types";

export interface AgendaItem {
  docId: string;
  docTitle: string;
  type: "deadline" | "payment";
  text: string;
  date?: string;
  amount?: string;
  severity: Severity;
}

export type AgendaBucket = "overdue" | "soon" | "upcoming" | "undated";

function isoOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Flatten every deadline/payment highlight into a date-sorted list (undated last). */
export function buildAgenda(docs: DocumentRecord[]): AgendaItem[] {
  const items: AgendaItem[] = [];
  for (const d of docs) {
    for (const h of d.analysis.highlights) {
      if (h.type === "deadline" || h.type === "payment") {
        items.push({
          docId: d.id,
          docTitle: d.analysis.title || "Untitled",
          type: h.type,
          text: h.text,
          date: h.date,
          amount: h.amount,
          severity: h.severity,
        });
      }
    }
  }
  return items.sort((a, b) => {
    if (a.date && b.date) return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
    if (a.date) return -1;
    if (b.date) return 1;
    return 0;
  });
}

/** Group agenda items into Overdue / Due soon (≤7 days) / Upcoming / No date. */
export function groupAgenda(
  items: AgendaItem[],
  today: Date = new Date(),
): { key: AgendaBucket; items: AgendaItem[] }[] {
  const iso = isoOf(today);
  const in7 = isoOf(new Date(today.getTime() + 7 * 86_400_000));

  const buckets: Record<AgendaBucket, AgendaItem[]> = {
    overdue: [],
    soon: [],
    upcoming: [],
    undated: [],
  };
  for (const it of items) {
    if (!it.date) buckets.undated.push(it);
    else if (it.date < iso) buckets.overdue.push(it);
    else if (it.date <= in7) buckets.soon.push(it);
    else buckets.upcoming.push(it);
  }

  return (["overdue", "soon", "upcoming", "undated"] as AgendaBucket[])
    .map((key) => ({ key, items: buckets[key] }))
    .filter((s) => s.items.length > 0);
}

/** Human-friendly relative label for a date, e.g. "in 3 days", "today", "2 days ago". */
export function relativeLabel(date: string | undefined, today: Date = new Date()): string {
  if (!date) return "";
  const t = new Date(isoOf(today) + "T00:00:00Z").getTime();
  const d = new Date(date + "T00:00:00Z").getTime();
  if (Number.isNaN(d)) return "";
  const days = Math.round((d - t) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  if (days < 0) return `${-days} days ago`;
  return `in ${days} days`;
}

export interface DashboardStats {
  upcomingCount: number;
  paymentsCount: number;
  criticalCount: number;
  nextDeadline: { text: string; date: string } | null;
}

/** Aggregate at-a-glance counts + the soonest upcoming deadline. */
export function dashboardStats(docs: DocumentRecord[], today: Date = new Date()): DashboardStats {
  const iso = isoOf(today);
  const all = docs.flatMap((d) => d.analysis.highlights);

  const upcomingDeadlines = all
    .filter((h) => h.type === "deadline" && h.date && h.date >= iso)
    .sort((a, b) => (a.date! < b.date! ? -1 : 1));

  return {
    upcomingCount: upcomingDeadlines.length,
    paymentsCount: all.filter((h) => h.type === "payment").length,
    criticalCount: all.filter((h) => h.type === "critical").length,
    nextDeadline: upcomingDeadlines[0]
      ? { text: upcomingDeadlines[0].text, date: upcomingDeadlines[0].date! }
      : null,
  };
}
