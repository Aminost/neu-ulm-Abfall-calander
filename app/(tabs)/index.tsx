import { useEffect, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
  Animated,
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
  RefreshCw,
  CheckCircle2,
  WifiOff,
} from "lucide-react-native";
import { fetchCollectionEvents, looksLikeCoordinates, getLastUpdateTimestamp } from "../../lib/dataFetcher";
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

/** 28 days — triggers a monthly auto-refresh when exceeded. */
const MONTHLY_REFRESH_MS = 28 * 24 * 60 * 60 * 1000;

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Format a Unix timestamp into a human-readable "X ago" string. */
function formatAge(ts: number, t: (key: string, p?: Record<string, string | number>) => string): string {
  const age = Date.now() - ts;
  const minutes = Math.floor(age / 60_000);
  const hours   = Math.floor(age / 3_600_000);
  const days    = Math.floor(age / 86_400_000);
  if (minutes < 2)  return t("justNow");
  if (hours   < 1)  return t("minutesAgo", { n: minutes });
  if (days    < 1)  return t("hoursAgo",   { n: hours });
  return t("daysAgo", { n: days });
}

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
    lastUpdated,
    isRefreshing,
    refreshData,
    syncLastUpdated,
  } = useAppState();

  // ── Local screen state ─────────────────────────────────────────────────────
  const [events,        setEvents]        = useState<CollectionEvent[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [viewMode,      setViewMode]      = useState<"list" | "calendar">("list");
  const [selectedDate,  setSelectedDate]  = useState<Date>(new Date());
  const [splashHidden,  setSplashHidden]  = useState(false);
  const [toastVisible,  setToastVisible]  = useState(false);
  const [toastType,     setToastType]     = useState<"success" | "error" | "info">("success");
  const [toastMsg,      setToastMsg]      = useState("");

  // Spinning animation for the refresh icon
  const spinAnim = useRef(new Animated.Value(0)).current;
  const spinLoop = useRef<Animated.CompositeAnimation | null>(null);

  // ── Start / stop spinner when isRefreshing changes ─────────────────────────
  useEffect(() => {
    if (isRefreshing) {
      spinAnim.setValue(0);
      spinLoop.current = Animated.loop(
        Animated.timing(spinAnim, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        })
      );
      spinLoop.current.start();
    } else {
      spinLoop.current?.stop();
      spinAnim.setValue(0);
    }
    return () => { spinLoop.current?.stop(); };
  }, [isRefreshing, spinAnim]);

  const spin = spinAnim.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });

  // ── Toast helper ──────────────────────────────────────────────────────────
  const showToast = useCallback(
    (msg: string, type: "success" | "error" | "info" = "success") => {
      setToastMsg(msg);
      setToastType(type);
      setToastVisible(true);
      setTimeout(() => setToastVisible(false), 3500);
    },
    []
  );

  // ── Fetch events whenever the district changes ─────────────────────────────
  useEffect(() => {
    if (!appLoaded) return;
    console.info(`[Home] districtId changed to ${districtId} — refetching events`);
    setLoading(true);
    fetchCollectionEvents(districtId)
      .then(async (evs) => {
        console.info(`[Home] fetched ${evs.length} events for Bezirk ${districtId}`);
        setEvents(evs);
        // Sync the last-updated timestamp now that fetch has completed
        // (fetchCollectionEvents may have written a fresh cache in background).
        await syncLastUpdated();
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

  // ── Monthly auto-refresh ───────────────────────────────────────────────────
  // After the initial events load, check if data is older than ~28 days.
  // If so, silently fetch fresh data from the city website in the background.
  const autoRefreshDone = useRef(false);
  useEffect(() => {
    if (loading || !appLoaded || autoRefreshDone.current) return;
    autoRefreshDone.current = true;

    const check = async () => {
      const ts = await getLastUpdateTimestamp(districtId);
      const needsRefresh = !ts || (Date.now() - ts) > MONTHLY_REFRESH_MS;
      if (!needsRefresh) return;

      console.info("[Home] Monthly auto-refresh triggered (data age > 28 days)");
      const result = await refreshData();
      if (result.success && result.events.length > 0) {
        setEvents(result.events);
        showToast(t("autoRefreshed"), "info");
        if (notificationsEnabled && Platform.OS !== "web") {
          scheduleReminders(result.events, reminderTime, 1, makeLabels()).catch(() => {});
        }
      }
    };
    check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, appLoaded]);

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

  // ── Manual refresh handler ─────────────────────────────────────────────────
  const handleRefresh = useCallback(async () => {
    if (isRefreshing) return;
    const result = await refreshData();
    if (result.success && result.events.length > 0) {
      setEvents(result.events);
      showToast(t("dataUpdated"), "success");
      if (notificationsEnabled && Platform.OS !== "web") {
        scheduleReminders(result.events, reminderTime, 1, makeLabels()).catch(() => {});
      }
    } else if (result.events.length > 0) {
      // Got events (from cache/built-in) but didn't get a fresh network response
      setEvents(result.events);
      showToast(t("dataAlreadyFresh"), "info");
    } else {
      showToast(t("dataUpdateFailed"), "error");
    }
  }, [isRefreshing, refreshData, notificationsEnabled, reminderTime, makeLabels, showToast, t]);

  // ── Notification toggle ────────────────────────────────────────────────────

  const handleToggleReminders = async () => {
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
    if (isToday(date))    return t("today");
    if (isTomorrow(date)) return t("tomorrow");
    return t("inDays", { days: differenceInDays(startOfDay(date), today) });
  };

  // Build react-native-calendars marked dates
  type MarkedDate = { dots: { key: string; color: string }[]; selected?: boolean; selectedColor?: string };
  const markedDates: Record<string, MarkedDate> = {};

  for (const event of events) {
    if (!event.date || isNaN(event.date.getTime())) continue;
    const cfg = WASTE_CONFIG[event.type];
    if (!cfg) continue;
    let key: string;
    try { key = format(event.date, "yyyy-MM-dd"); } catch { continue; }
    if (!markedDates[key]) markedDates[key] = { dots: [] };
    if (!markedDates[key].dots.some((d) => d.key === event.type)) {
      markedDates[key].dots.push({ key: event.type, color: cfg.calendarDotColor });
    }
  }

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

  // Toast colours
  const toastBg   = toastType === "success" ? "#ecfdf5" : toastType === "error" ? "#fef2f2" : "#eff6ff";
  const toastBdr  = toastType === "success" ? "#6ee7b7" : toastType === "error" ? "#fca5a5" : "#93c5fd";
  const toastText = toastType === "success" ? "#065f46" : toastType === "error" ? "#991b1b" : "#1e40af";
  const ToastIcon = toastType === "success" ? CheckCircle2 : toastType === "error" ? WifiOff : CheckCircle2;
  const toastIconColor = toastType === "success" ? "#059669" : toastType === "error" ? "#dc2626" : "#3b82f6";

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView className="flex-1 bg-gray-50" onLayout={onLayoutReady}>
      {/* ── In-app toast ── */}
      {toastVisible && (
        <View
          style={{
            position: "absolute", top: 52, left: 16, right: 16, zIndex: 999,
            flexDirection: "row", alignItems: "center", gap: 10,
            backgroundColor: toastBg, borderWidth: 1, borderColor: toastBdr,
            borderRadius: 16, paddingHorizontal: 16, paddingVertical: 12,
            shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 12, elevation: 6,
          }}
        >
          <ToastIcon size={18} color={toastIconColor} />
          <Text style={{ flex: 1, fontSize: 13, fontWeight: "600", color: toastText }} numberOfLines={2}>
            {toastMsg}
          </Text>
        </View>
      )}

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header ── */}
        <View className="px-6 pt-8 pb-4 flex-row justify-between items-start">
          <View className="flex-1 mr-3">
            <Text className="text-3xl font-bold text-gray-900 tracking-tight">
              {t("calendarTitle")}
            </Text>
            {/* Address */}
            <Text className="text-gray-500 mt-1" numberOfLines={2}>
              {address && !looksLikeCoordinates(address) ? address : `Bezirk ${districtId}`}
            </Text>
            {/* Bezirk badge + last-updated */}
            <View className="flex-row items-center gap-2 mt-1 flex-wrap">
              <View className="bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full self-start">
                <Text className="text-emerald-600 text-xs font-semibold">
                  Bezirk {districtId}
                </Text>
              </View>
              {lastUpdated ? (
                <Text className="text-gray-400 text-xs">
                  {t("lastUpdated")}: {formatAge(lastUpdated, t)}
                </Text>
              ) : null}
            </View>
          </View>

          {/* Right controls: refresh + view-mode toggle */}
          <View className="flex-row items-center gap-2">
            {/* Refresh button */}
            <TouchableOpacity
              onPress={handleRefresh}
              disabled={isRefreshing}
              className="p-2 rounded-xl bg-white border border-gray-200"
              style={{ shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 }}
              accessibilityLabel={t("refreshData")}
            >
              {isRefreshing ? (
                <ActivityIndicator size="small" color="#10b981" style={{ width: 20, height: 20 }} />
              ) : (
                <Animated.View style={{ transform: [{ rotate: spin }] }}>
                  <RefreshCw size={20} color="#374151" />
                </Animated.View>
              )}
            </TouchableOpacity>

            {/* List / Calendar toggle */}
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
