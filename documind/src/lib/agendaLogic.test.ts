// App-side unit tests for the Agenda / dashboard logic.
// Run with:  npm test   (node --import tsx --test src/lib/agendaLogic.test.ts)

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildAgenda,
  dashboardStats,
  groupAgenda,
  relativeLabel,
  type AgendaItem,
} from "./agendaLogic";
import type { DocumentRecord } from "./types";

const TODAY = new Date("2026-07-09T12:00:00Z");

function doc(id: string, highlights: DocumentRecord["analysis"]["highlights"]): DocumentRecord {
  return {
    id,
    createdAt: 0,
    status: "ready",
    analysis: {
      title: `Doc ${id}`,
      category: "Other",
      summary: "",
      language: "German",
      fullText: "",
      highlights,
      entities: [],
      relations: [],
    },
  };
}

const docs: DocumentRecord[] = [
  doc("a", [
    { id: "1", type: "payment", text: "Invoice", amount: "149,90 EUR", date: "2026-08-15", severity: "high" },
    { id: "2", type: "critical", text: "Cut-off risk", severity: "high" },
  ]),
  doc("b", [
    { id: "3", type: "deadline", text: "Return form", date: "2026-07-11", severity: "high" }, // in 2 days
    { id: "4", type: "deadline", text: "Old fine", date: "2026-07-01", severity: "high" }, // overdue
    { id: "5", type: "payment", text: "No date fee", severity: "low" }, // undated
  ]),
];

test("buildAgenda flattens deadlines/payments and sorts by date (undated last)", () => {
  const items = buildAgenda(docs);
  // 4 items: 2 deadlines + 2 payments (critical excluded)
  assert.equal(items.length, 4);
  const dates = items.map((i) => i.date ?? "none");
  assert.deepEqual(dates, ["2026-07-01", "2026-07-11", "2026-08-15", "none"]);
});

test("groupAgenda buckets by urgency", () => {
  const groups = groupAgenda(buildAgenda(docs), TODAY);
  const byKey = Object.fromEntries(groups.map((g) => [g.key, g.items]));
  assert.equal(byKey.overdue?.length, 1); // 2026-07-01
  assert.equal(byKey.soon?.length, 1); // 2026-07-11 (within 7 days)
  assert.equal(byKey.upcoming?.length, 1); // 2026-08-15
  assert.equal(byKey.undated?.length, 1); // no date
  // empty buckets are omitted
  assert.ok(groups.every((g) => g.items.length > 0));
});

test("relativeLabel is human-friendly and deterministic", () => {
  assert.equal(relativeLabel("2026-07-09", TODAY), "today");
  assert.equal(relativeLabel("2026-07-10", TODAY), "tomorrow");
  assert.equal(relativeLabel("2026-07-08", TODAY), "yesterday");
  assert.equal(relativeLabel("2026-07-12", TODAY), "in 3 days");
  assert.equal(relativeLabel("2026-07-02", TODAY), "7 days ago");
  assert.equal(relativeLabel(undefined, TODAY), "");
});

test("dashboardStats aggregates counts and next deadline", () => {
  const s = dashboardStats(docs, TODAY);
  assert.equal(s.paymentsCount, 2);
  assert.equal(s.criticalCount, 1);
  assert.equal(s.upcomingCount, 1); // only 2026-07-11 is >= today (2026-07-01 is past)
  assert.equal(s.nextDeadline?.date, "2026-07-11");
  assert.equal(s.nextDeadline?.text, "Return form");
});

test("empty library yields empty agenda and zeroed stats", () => {
  assert.deepEqual(buildAgenda([]), [] as AgendaItem[]);
  assert.deepEqual(groupAgenda([], TODAY), []);
  const s = dashboardStats([], TODAY);
  assert.equal(s.upcomingCount, 0);
  assert.equal(s.nextDeadline, null);
});
