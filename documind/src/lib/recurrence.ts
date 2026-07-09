// Detect recurring obligations (monthly rent, annual insurance, …) from German
// or English document text, so DocuMind can set repeating reminders. Pure and
// framework-agnostic — unit-tested in recurrence.test.ts.

export type Recurrence = "weekly" | "monthly" | "quarterly" | "yearly";

export function detectRecurrence(text: string): Recurrence | null {
  const t = text.toLowerCase();
  // Order matters: "vierteljährlich" contains "jährlich", so check quarterly before yearly.
  if (/w[öo]chentlich|weekly|per week|every week/.test(t)) return "weekly";
  if (/monatlich|pro monat|je monat|\/\s*monat|per month|monthly|each month|every month/.test(t))
    return "monthly";
  if (/viertelj[äa]hrlich|quartalsweise|quarterly|per quarter|every quarter/.test(t))
    return "quarterly";
  if (/j[äa]hrlich|pro jahr|\/\s*jahr|per year|yearly|annually|per annum/.test(t)) return "yearly";
  return null;
}

/** Human label for a recurrence. */
export function recurrenceLabel(r: Recurrence): string {
  return { weekly: "Weekly", monthly: "Monthly", quarterly: "Quarterly", yearly: "Yearly" }[r];
}
