// Local deadline/payment reminders — the "keep you alerted" part of DocuMind.
// Lead time and whether payments are included are user-configurable in Settings.
// Uses only local scheduled notifications (no push server); works in Expo Go and
// dev builds. No-ops on web.

import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { detectRecurrence, type Recurrence } from "./recurrence";
import { getSettings } from "./storage";
import type { DocumentRecord, HighlightType } from "./types";

/** Build a repeating trigger for a detected recurrence anchored on a due date. */
function recurringTrigger(rec: Recurrence, due: Date): Notifications.NotificationTriggerInput | null {
  const hour = 9;
  const minute = 0;
  switch (rec) {
    case "weekly":
      return { type: Notifications.SchedulableTriggerInputTypes.WEEKLY, weekday: due.getDay() + 1, hour, minute };
    case "monthly":
      return { type: Notifications.SchedulableTriggerInputTypes.MONTHLY, day: due.getDate(), hour, minute };
    case "yearly":
      return { type: Notifications.SchedulableTriggerInputTypes.YEARLY, month: due.getMonth() + 1, day: due.getDate(), hour, minute };
    default:
      return null; // quarterly has no native repeat trigger — skip
  }
}

let configured = false;

export function configureNotifications(): void {
  if (configured || Platform.OS === "web") return;
  configured = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

export async function ensureNotificationPermission(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const req = await Notifications.requestPermissionsAsync();
  return req.granted;
}

/**
 * Schedule reminders for a document's dated deadlines (and payments, if enabled):
 * one at the configured lead time before, one on the day. Returns how many were
 * scheduled.
 */
export async function scheduleDeadlineReminders(doc: DocumentRecord): Promise<number> {
  if (Platform.OS === "web") return 0;

  const settings = await getSettings();
  const leadDays = Math.max(0, settings.reminderDaysBefore ?? 2);
  const includePayments = settings.remindPayments ?? true;
  const wantedTypes: HighlightType[] = includePayments ? ["deadline", "payment"] : ["deadline"];

  const dated = doc.analysis.highlights.filter((h) => wantedTypes.includes(h.type) && h.date);
  if (dated.length === 0) return 0;
  if (!(await ensureNotificationPermission())) return 0;

  const now = Date.now();
  let scheduled = 0;

  for (const h of dated) {
    const due = new Date(`${h.date}T09:00:00`);
    if (Number.isNaN(due.getTime())) continue;

    const title = doc.analysis.title || "Document deadline";
    const body = h.text + (h.amount ? ` — ${h.amount}` : "");
    const lead = new Date(due.getTime() - leadDays * 86_400_000);

    const points: { when: Date; label: string }[] = [
      { when: lead, label: leadDays === 0 ? "Due today" : `Due in ${leadDays} day${leadDays === 1 ? "" : "s"}` },
      { when: due, label: "Due today" },
    ];

    for (const p of points) {
      if (p.when.getTime() <= now + 60_000) continue; // don't schedule in the past
      await Notifications.scheduleNotificationAsync({
        content: { title: `${p.label}: ${title}`, body, data: { docId: doc.id } },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: p.when },
      });
      scheduled += 1;
    }

    // Recurring obligation (monthly rent, annual insurance, …) → repeating reminder.
    const rec = detectRecurrence(`${doc.analysis.fullText} ${h.text}`);
    if (rec) {
      const trigger = recurringTrigger(rec, due);
      if (trigger) {
        await Notifications.scheduleNotificationAsync({
          content: { title: `Recurring (${rec}): ${title}`, body, data: { docId: doc.id } },
          trigger,
        });
        scheduled += 1;
      }
    }
  }

  return scheduled;
}

/** Cancel all pending reminders and reschedule from the current library. */
export async function rescheduleAll(docs: DocumentRecord[]): Promise<number> {
  if (Platform.OS === "web") return 0;
  await Notifications.cancelAllScheduledNotificationsAsync();
  let total = 0;
  for (const doc of docs) total += await scheduleDeadlineReminders(doc);
  return total;
}
