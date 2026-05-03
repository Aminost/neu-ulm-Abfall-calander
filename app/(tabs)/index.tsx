import { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as SplashScreen from "expo-splash-screen";
import { Calendar, type DateData } from "react-native-calendars";
import {
  format,
  differenceInDays,
  isToday,
  isTomorrow,
  isSameDay,
  startOfDay,
} from "date-fns";
import { de, enUS, tr, ar, fr, hi, es, ru } from "date-fns/locale";
import {
  Trash2,
  Leaf,
  Package,
  Recycle,
  List,
  Calendar as CalendarIcon,
  Bell,
  BellRing,
} from "lucide-react-native";
import { fetchCollectionEvents, looksLikeCoordinates } from "../../lib/dataFetcher";
import type { CollectionEvent, WasteType } from "../../lib/icsParser";
import { useTranslation } from "../../lib/i18n";
import type { Language } from "../../lib/i18n";
import { useAppState } from "../../lib/appState";
import {
  requestNotificationPermission,
  scheduleReminders,
  cancelAllReminders,
} from "../../lib/notificationScheduler";

// ── Waste type configuration ───────────────────────────────────────────────────

const WASTE_CONFIG: Record<
  WasteType,
  {
    color: string;
    bgClass: string;
    iconBg: string;
    dotColor: string;
    calendarDotColor: string;
    Icon: typeof Trash2;
  }
> = {
  "Rest- & Biomüll": {
    color: "#1f2937",
    bgClass: "bg-gray-100",
    iconBg: "#f3f4f6",
    dotColor: "#1f2937",
    calendarDotColor: "#4b5563",
    Icon: Trash2,
  },
  Grüngut: {
    color: "#065f46",
    bgClass: "bg-emerald-100",
    iconBg: "#d1fae5",
    dotColor: "#059669",
    calendarDotColor: "#10b981",
    Icon: Leaf,
  },
  Papiertonne: {
    color: "#1d4ed8",
    bgClass: "bg-blue-100",
    iconBg: "#dbeafe",
    dotColor: "#3b82f6",
    calendarDotColor: "#3b82f6",
    Icon: Package,
  },
  "Gelber Sack": {
    color: "#92400e",
    bgClass: "bg-yellow-100",
    iconBg: "#fef3c7",
    dotColor: "#f59e0b",
    calendarDotColor: "#fbbf24",
    Icon: Recycle,
  },
};

const DATE_LOCALES: Record<Language, import("date-fns").Locale> = {
  de, en: enUS, tr, ar, fr, hi, es, ru,
};

// ── Component ──────────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const { t, language, isLoading: langLoading } = useTranslation();

  // Shared state — synced live with Settings screen via AppStateContext
  const {
    districtId,
    address,
    notificationsEnabled,
    reminderTime,
    isLoaded: appLoaded,
    updateNotifications,
  } = useAppState();

  // Local screen state
  const [events,       setEvents]       = useState<CollectionEvent[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [viewMode,     setViewMode]     = useState<"list" | "calendar">("list");
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [splashHidden, setSplashHidden] = useState(false);

  // ── Fetch events whenever the district changes ─────────────────────────────
  // appLoaded prevents a double-fetch: first with the default districtId=5,
  // then again once AsyncStorage resolves the real saved district.
  useEffect(() => {
    if (!appLoaded) return;
    console.info(`[Home] districtId changed to ${districtId} — refetching events`);
    setLoading(true);
    fetchCollectionEvents(districtId)
      .then((evs) => {
        console.info(`[Home] fetched ${evs.length} events for Bezirk ${districtId}`);
        setEvents(evs);
        // Re-schedule notifications whenever the district (and hence the
        // event list) changes, so we never alert for an old Bezirk's dates.
        if (notificationsEnabled && Platform.OS !== "web") {
          scheduleReminders(evs, reminderTime, 1, makeLabels()).catch((err) =>
            console.warn("re-schedule on district change failed", err)
          );
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [districtId, appLoaded]);

  // ── Hide splash screen once initial data is ready ──────────────────────────
  const onLayoutReady = useCallback(async () => {
    if (!loading && !langLoading && !splashHidden) {
      setSplashHidden(true);
      await SplashScreen.hideAsync();
    }
  }, [loading, langLoading, splashHidden]);

  // ── Helpers ────────────────────────────────────────────────────────────────

  const makeLabels = useCallback(
    () => ({
      "Rest- & Biomüll": t("Rest- & Biomüll"),
      Grüngut:           t("Grüngut"),
      Papiertonne:       t("Papiertonne"),
      "Gelber Sack":     t("Gelber Sack"),
    }),
    [t]
  );

  // ── Notification toggle ────────────────────────────────────────────────────

  const handleToggleReminders = async () => {
    // Web: persist the preference so it carries over to a native install,
    // but show a one-time hint that web preview cannot fire pushes.
    if (Platform.OS === "web") {
      const next = !notificationsEnabled;
      await updateNotifications(next);
      if (next) Alert.alert(t("notifsNotSupported"));
      return;
    }

    if (!notificationsEnabled) {
      try {
        const granted = await requestNotificationPermission();
        if (!granted) {
          Alert.alert(
            t("allowNotifs"),
            Platform.OS === "ios"
              ? "Einstellungen → Mitteilungen → Neu-Ulm Müllkalender"
              : "Einstellungen → Apps → Neu-Ulm Müllkalender → Benachrichtigungen"
          );
          return;
        }
        await updateNotifications(true);
        const n = await scheduleReminders(events, reminderTime, 1, makeLabels());
        Alert.alert(t("notifsActivated"), t("remindersScheduled", { count: n }));
      } catch (err) {
        console.warn("toggle reminders enable failed", err);
        await updateNotifications(false);
      }
    } else {
      await updateNotifications(false);
      await cancelAllReminders();
      Alert.alert(t("notifsDeactivated"));
    }
  };

  // ── Loading state ──────────────────────────────────────────────────────────

  if (loading || langLoading || !appLoaded) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-50">
        <ActivityIndicator size="large" color="#10b981" />
      </View>
    );
  }

  // ── Derived values ─────────────────────────────────────────────────────────

  const today          = startOfDay(new Date());
  const futureEvents   = events.filter((e) => e.date >= today);
  const nextEvent      = futureEvents[0];
  const upcomingEvents = futureEvents.slice(1, 15);
  const dateLocale     = DATE_LOCALES[language];

  const getDaysText = (date: Date) => {
    if (isToday(date))   return t("today");
    if (isTomorrow(date)) return t("tomorrow");
    return t("inDays", { days: differenceInDays(startOfDay(date), today) });
  };

  // Build react-native-calendars marked dates — defensively, so a single bad
  // event date or unknown waste type can never crash the calendar view.
  type MarkedDate = { dots: { key: string; color: string }[]; selected?: boolean; selectedColor?: string };
  const markedDates: Record<string, MarkedDate> = {};

  for (const event of events) {
    if (!event.date || isNaN(event.date.getTime())) continue;
    const cfg = WASTE_CONFIG[event.type];
    if (!cfg) continue;
    let key: string;
    try { key = format(event.date, "yyyy-MM-dd"); } catch { continue; }
    if (!markedDates[key]) markedDates[key] = { dots: [] };
    // Dedupe dots within a day (multiple R/B events on same day → 1 dot)
    if (!markedDates[key].dots.some((d) => d.key === event.type)) {
      markedDates[key].dots.push({
        key: event.type,
        color: cfg.calendarDotColor,
      });
    }
  }

  // Mark the selected date — guard against an invalid Date
  let selectedKey = "";
  if (selectedDate && !isNaN(selectedDate.getTime())) {
    try { selectedKey = format(selectedDate, "yyyy-MM-dd"); } catch { /* ignore */ }
  }
  if (selectedKey) {
    markedDates[selectedKey] = {
      ...(markedDates[selectedKey] ?? { dots: [] }),
      selected: true,
      selectedColor: "#10b981",
    };
  }

  const eventsOnSelectedDate = events.filter(
    (e) => e.date && !isNaN(e.date.getTime()) && isSameDay(e.date, selectedDate)
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView className="flex-1 bg-gray-50" onLayout={onLayoutReady}>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header ── */}
        <View className="px-6 py-8 flex-row justify-between items-start">
          <View className="flex-1 mr-4">
            <Text className="text-3xl font-bold text-gray-900 tracking-tight">
              {t("calendarTitle")}
            </Text>
            {/* Full address — shows complete street + postcode + Stadtteil.
                Never show raw coordinates; fall back to "Bezirk N" instead. */}
            <Text className="text-gray-500 mt-1" numberOfLines={2}>
              {address && !looksLikeCoordinates(address) ? address : `Bezirk ${districtId}`}
            </Text>
            <Text className="text-emerald-600 text-xs font-semibold mt-1">
              Bezirk {districtId}
            </Text>
          </View>
          {/* View mode toggle */}
          <View className="flex-row bg-gray-200 p-1 rounded-xl">
            <TouchableOpacity
              onPress={() => setViewMode("list")}
              className={`p-2 rounded-lg ${viewMode === "list" ? "bg-white shadow-sm" : ""}`}
            >
              <List size={20} color={viewMode === "list" ? "#111827" : "#6b7280"} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setViewMode("calendar")}
              className={`p-2 rounded-lg ${viewMode === "calendar" ? "bg-white shadow-sm" : ""}`}
            >
              <CalendarIcon size={20} color={viewMode === "calendar" ? "#111827" : "#6b7280"} />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Notification chip ── */}
        <View className="px-6 mb-6">
          <TouchableOpacity
            onPress={handleToggleReminders}
            activeOpacity={0.75}
            className={`self-start flex-row items-center gap-2 px-4 py-2.5 rounded-full border ${
              notificationsEnabled
                ? "bg-emerald-50 border-emerald-200"
                : "bg-white border-gray-200"
            }`}
          >
            {notificationsEnabled ? (
              <BellRing size={16} color="#059669" />
            ) : (
              <Bell size={16} color="#374151" />
            )}
            <Text
              className={`text-sm font-medium ${
                notificationsEnabled ? "text-emerald-700" : "text-gray-700"
              }`}
            >
              {notificationsEnabled ? t("remindersActive") : t("activateReminders")}
            </Text>
          </TouchableOpacity>
        </View>

        {/* ── List view ── */}
        {viewMode === "list" ? (
          <View className="px-6 gap-8">
            {/* Hero card */}
            {nextEvent ? (
              <View>
                <Text className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                  {t("nextPickup")}
                </Text>
                <View
                  className="rounded-3xl p-6 overflow-hidden border"
                  style={{
                    backgroundColor: WASTE_CONFIG[nextEvent.type].iconBg,
                    borderColor: "rgba(255,255,255,0.2)",
                  }}
                >
                  <View className="flex-row justify-between items-start">
                    <View>
                      <Text
                        className="text-5xl font-bold tracking-tight"
                        style={{ color: WASTE_CONFIG[nextEvent.type].color }}
                      >
                        {getDaysText(nextEvent.date)}
                      </Text>
                      <Text
                        className="text-lg font-medium mt-2"
                        style={{ color: WASTE_CONFIG[nextEvent.type].color, opacity: 0.8 }}
                      >
                        {format(nextEvent.date, "EEEE, d. MMMM", { locale: dateLocale })}
                      </Text>
                      <View
                        className="mt-6 flex-row items-center gap-2 self-start px-4 py-2 rounded-full"
                        style={{ backgroundColor: "rgba(255,255,255,0.5)" }}
                      >
                        {(() => {
                          const { Icon } = WASTE_CONFIG[nextEvent.type];
                          return <Icon size={20} color={WASTE_CONFIG[nextEvent.type].color} />;
                        })()}
                        <Text className="font-semibold" style={{ color: WASTE_CONFIG[nextEvent.type].color }}>
                          {t(nextEvent.type)}
                        </Text>
                      </View>
                    </View>
                  </View>
                </View>
              </View>
            ) : (
              <View className="items-center py-12">
                <Text className="text-gray-500">{t("noPickups")}</Text>
              </View>
            )}

            {/* Upcoming list */}
            {upcomingEvents.length > 0 && (
              <View>
                <Text className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">
                  {t("upcoming")}
                </Text>
                <View className="gap-3">
                  {upcomingEvents.map((event) => {
                    const { Icon, iconBg, color } = WASTE_CONFIG[event.type];
                    return (
                      <View
                        key={event.id}
                        className="flex-row items-center gap-4 p-4 bg-white rounded-2xl border border-gray-100"
                        style={{ shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 }}
                      >
                        <View
                          className="w-12 h-12 rounded-xl items-center justify-center"
                          style={{ backgroundColor: iconBg }}
                        >
                          <Icon size={24} color={color} />
                        </View>
                        <View className="flex-1">
                          <Text className="font-semibold text-gray-900" numberOfLines={1}>
                            {t(event.type)}
                          </Text>
                          <Text className="text-sm text-gray-500" numberOfLines={1}>
                            {format(event.date, "EEEE, d. MMM", { locale: dateLocale })}
                          </Text>
                        </View>
                        <Text className="text-sm font-medium text-gray-900">
                          {getDaysText(event.date)}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            )}
          </View>
        ) : (
          /* ── Calendar view ── */
          <View
            className="mx-6 bg-white rounded-3xl p-4 border border-gray-100"
            style={{ shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 8, elevation: 2 }}
          >
            <Calendar
              // Remount the calendar when the active district changes — keeps
              // marked dots in sync with whatever events were just loaded.
              key={`cal-${districtId}`}
              markingType="multi-dot"
              markedDates={markedDates}
              onDayPress={(day: DateData) => {
                if (!day?.dateString) return;
                const next = new Date(`${day.dateString}T00:00:00`);
                if (!isNaN(next.getTime())) setSelectedDate(next);
              }}
              theme={{
                todayTextColor: "#10b981",
                selectedDayBackgroundColor: "#10b981",
                selectedDayTextColor: "#ffffff",
                arrowColor: "#10b981",
                dotColor: "#10b981",
                textDayFontWeight: "500",
                textMonthFontWeight: "700",
              }}
            />

            <View className="border-t border-gray-100 mt-2 pt-4">
              <Text className="font-semibold text-gray-900 mb-4">
                {selectedDate && !isNaN(selectedDate.getTime())
                  ? format(selectedDate, "EEEE, dd. MMMM", { locale: dateLocale })
                  : ""}
              </Text>
              {eventsOnSelectedDate.length > 0 ? (
                <View className="gap-3">
                  {eventsOnSelectedDate.map((event, idx) => {
                    const cfg = WASTE_CONFIG[event.type];
                    if (!cfg) return null;
                    const { Icon, iconBg, color } = cfg;
                    // Date for the row — short form, e.g. "Mi, 14. Jan."
                    const dayLabel =
                      event.date && !isNaN(event.date.getTime())
                        ? format(event.date, "EEE, d. MMM", { locale: dateLocale })
                        : "";
                    return (
                      <View
                        key={idx}
                        className="bg-gray-50 rounded-2xl p-4 flex-row items-center gap-4 border border-gray-100"
                      >
                        <View className="p-3 rounded-xl" style={{ backgroundColor: iconBg }}>
                          <Icon size={24} color={color} />
                        </View>
                        <View className="flex-1">
                          <Text className="font-semibold text-gray-900">{t(event.type)}</Text>
                          <Text className="text-sm text-gray-500">{dayLabel}</Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              ) : (
                <Text className="text-gray-500 text-sm text-center py-4">
                  {t("noPickups")}
                </Text>
              )}
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
