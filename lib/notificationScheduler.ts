/**
 * lib/notificationScheduler.ts
 *
 * Schedules local push notifications for upcoming waste collections.
 * Uses expo-notifications on iOS / Android. Web is gracefully a no-op
 * (browser scheduled-push needs Service Workers + a server, which is out of
 * scope for this app).
 *
 * Key design choices:
 *   - Dynamic import keeps expo-notifications out of the web bundle.
 *   - The Android channel is created lazily, idempotently, inside
 *     scheduleReminders. This guarantees it exists even if
 *     configureNotifications() hasn't completed yet.
 *   - All scheduled notifications are cancelled before re-scheduling — so
 *     re-schedules stay in lock-step with the latest events / time.
 *   - scheduleReminders returns the number of notifications actually scheduled
 *     so callers can show meaningful feedback ("X reminders scheduled").
 */
import { Platform } from "react-native";
import { addDays, startOfDay, setHours, setMinutes, isBefore } from "date-fns";
import type { CollectionEvent } from "./icsParser";

const NOTIFICATION_CHANNEL_ID = "waste-reminders";
const REMINDER_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// ── Setup ──────────────────────────────────────────────────────────────────────

/** Configure notification appearance (call once at app startup). No-op on web. */
export function configureNotifications() {
  if (Platform.OS === "web") return;

  // Fire-and-forget; failures here should not crash the app boot.
  import("expo-notifications")
    .then((Notifications) => {
      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowAlert: true,
          shouldPlaySound: false,
          shouldSetBadge: false,
          shouldShowBanner: true,
          shouldShowList: true,
        }),
      });

      if (Platform.OS === "android") {
        return Notifications.setNotificationChannelAsync(NOTIFICATION_CHANNEL_ID, {
          name: "Abholung-Erinnerungen",
          importance: Notifications.AndroidImportance.DEFAULT,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: "#10b981",
        });
      }
    })
    .catch((err) => {
      console.warn("configureNotifications: expo-notifications import failed", err);
    });
}

// ── Core API ───────────────────────────────────────────────────────────────────

/** Cancel all scheduled waste-reminder notifications. No-op on web. */
export async function cancelAllReminders(): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    const Notifications = await import("expo-notifications");
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch (err) {
    console.warn("cancelAllReminders failed", err);
  }
}

/**
 * Schedule one notification per upcoming event (max 30 to stay within iOS
 * limits). Returns the number scheduled. No-op on web (returns 0).
 *
 * @param events       List of collection events (any order; we sort).
 * @param reminderTime "HH:MM" string — local time on the day-before to fire.
 * @param daysBefore   How many days before the collection to remind.
 * @param labels       Localised waste-type strings.
 */
export async function scheduleReminders(
  events: CollectionEvent[],
  reminderTime: string,
  daysBefore: number,
  labels: Record<string, string>
): Promise<number> {
  if (Platform.OS === "web") return 0;

  if (!REMINDER_TIME_RE.test(reminderTime)) {
    console.warn(`scheduleReminders: invalid reminderTime "${reminderTime}", expected HH:MM`);
    return 0;
  }

  let Notifications: typeof import("expo-notifications");
  try {
    Notifications = await import("expo-notifications");
  } catch (err) {
    console.warn("scheduleReminders: expo-notifications import failed", err);
    return 0;
  }

  // Ensure the Android channel exists every time (idempotent).
  if (Platform.OS === "android") {
    try {
      await Notifications.setNotificationChannelAsync(NOTIFICATION_CHANNEL_ID, {
        name: "Abholung-Erinnerungen",
        importance: Notifications.AndroidImportance.DEFAULT,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: "#10b981",
      });
    } catch (err) {
      console.warn("scheduleReminders: channel create failed", err);
    }
  }

  // Reset before scheduling so we never accumulate stale entries.
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch { /* ignore */ }

  const [hours, minutes] = reminderTime.split(":").map((s) => parseInt(s, 10));
  const now = new Date();

  const upcoming = [...events]
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .filter((e) => e.date >= startOfDay(now))
    .slice(0, 30);

  let scheduled = 0;
  for (const event of upcoming) {
    const triggerDate = setMinutes(
      setHours(addDays(startOfDay(event.date), -daysBefore), hours),
      minutes
    );
    if (isBefore(triggerDate, now)) continue;

    const label = labels[event.type] ?? event.type;
    const dayStr = event.date.toLocaleDateString("de-DE", {
      weekday: "long",
      day: "numeric",
      month: "short",
    });

    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: `🗑 Morgen: ${label}`,
          body: `Abholung am ${dayStr} — bitte heute Abend herausstellen!`,
          data: { eventId: event.id },
          ...(Platform.OS === "android" ? { channelId: NOTIFICATION_CHANNEL_ID } : {}),
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: triggerDate,
        },
      });
      scheduled++;
    } catch (err) {
      console.warn(`scheduleReminders: failed to schedule for ${event.id}`, err);
    }
  }

  console.info(`scheduleReminders: ${scheduled}/${upcoming.length} reminders scheduled`);
  return scheduled;
}

// ── Permission ─────────────────────────────────────────────────────────────────

/** Request notification permission. Returns true if granted. Always false on web. */
export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  try {
    const Notifications = await import("expo-notifications");
    const { status: existing } = await Notifications.getPermissionsAsync();
    if (existing === "granted") return true;
    const { status } = await Notifications.requestPermissionsAsync();
    return status === "granted";
  } catch (err) {
    console.warn("requestNotificationPermission failed", err);
    return false;
  }
}
