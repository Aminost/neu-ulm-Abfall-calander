// Unit tests for recurring-obligation detection.
// Run with:  npm test

import assert from "node:assert/strict";
import { test } from "node:test";
import { detectRecurrence, recurrenceLabel } from "./recurrence";

test("detectRecurrence handles German and English cues", () => {
  assert.equal(detectRecurrence("Der Betrag wird monatlich abgebucht."), "monthly");
  assert.equal(detectRecurrence("Monthly subscription fee"), "monthly");
  assert.equal(detectRecurrence("Beitrag 12,00 EUR pro Monat"), "monthly");
  assert.equal(detectRecurrence("Jährliche Versicherungsprämie"), "yearly");
  assert.equal(detectRecurrence("billed annually"), "yearly");
  assert.equal(detectRecurrence("Vierteljährliche Abrechnung"), "quarterly");
  assert.equal(detectRecurrence("wöchentliche Lieferung"), "weekly");
});

test("quarterly is not misread as yearly (substring trap)", () => {
  // "vierteljährlich" contains "jährlich"
  assert.equal(detectRecurrence("Zahlung vierteljährlich fällig"), "quarterly");
});

test("one-off documents return null", () => {
  assert.equal(detectRecurrence("Einmalige Zahlung bis 15.08.2026"), null);
  assert.equal(detectRecurrence("Please pay this invoice once."), null);
});

test("recurrenceLabel is readable", () => {
  assert.equal(recurrenceLabel("monthly"), "Monthly");
  assert.equal(recurrenceLabel("yearly"), "Yearly");
});
