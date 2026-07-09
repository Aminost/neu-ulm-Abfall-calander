// Local deadline reminders — the "keep you alerted" part of DocuMind. When a
// document has a detected deadline, we schedule on-device notifications a couple
// of days before and on the day, so bureaucratic due-dates don't slip.
//
// Uses only local scheduled notifications (no push server), which work in Expo
// Go and dev builds. No-ops on web.

import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import type { DocumentRecord } from "./types";

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
 * Schedule reminders for every dated deadline in a document.
 * Returns the number of notifications scheduled.
 */
export async function scheduleDeadlineReminders(doc: DocumentRecord): Promise<number> {
  if (Platform.OS === "web") return 0;

  const deadlines = doc.analysis.highlights.filter((h) => h.type === "deadline" && h.date);
  if (deadlines.length === 0) return 0;

  if (!(await ensureNotificationPermission())) return 0;

  const now = Date.now();
  let scheduled = 0;

  for (const h of deadlines) {
    const due = new Date(`${h.date}T09:00:00`);
    if (Number.isNaN(due.getTime())) continue;

    const title = doc.analysis.title || "Document deadline";
    const body = h.text + (h.amount ? ` — ${h.amount}` : "");
    const twoDaysBefore = new Date(due.getTime() - 2 * 86_400_000);

    const points: { when: Date; label: string }[] = [
      { when: twoDaysBefore, label: "Due in 2 days" },
      { when: due, label: "Due today" },
    ];

    for (const p of points) {
      if (p.when.getTime() <= now + 60_000) continue; // don't schedule in the past
      await Notifications.scheduleNotificationAsync({
        content: {
          title: `${p.label}: ${title}`,
          body,
          data: { docId: doc.id },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: p.when,
        },
      });
      scheduled += 1;
    }
  }

  return scheduled;
}
