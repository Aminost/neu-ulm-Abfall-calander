import { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  Switch,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
  Alert,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import {
  Bell,
  Clock,
  Globe,
  MapPin,
  Trash2,
  FileText,
  ExternalLink,
  ChevronDown,
  Info,
  Locate,
  CheckCircle,
  RefreshCw,
  Database,
  CheckCircle2,
  WifiOff,
} from "lucide-react-native";
import { storage } from "../../lib/storage";
import { BEZIRKE } from "../../lib/constants";
import {
  IMPORTED_ICS_KEY,
  fetchCollectionEvents,
  looksLikeCoordinates,
} from "../../lib/dataFetcher";
import {
  requestNotificationPermission,
  scheduleReminders,
  cancelAllReminders,
} from "../../lib/notificationScheduler";
import { useTranslation } from "../../lib/i18n";
import type { Language } from "../../lib/i18n";
import { useAppState } from "../../lib/appState";

// ── Helpers ────────────────────────────────────────────────────────────────────

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

// ── Config ─────────────────────────────────────────────────────────────────────

const REMINDER_TIMES = [
  { value: "17:00", labelKey: "time17" },
  { value: "18:00", labelKey: "time18" },
  { value: "19:00", labelKey: "time19" },
  { value: "20:00", labelKey: "time20" },
  { value: "06:00", labelKey: "time06" },
  { value: "07:00", labelKey: "time07" },
];

const LANGUAGES: { code: Language; label: string; flag: string }[] = [
  { code: "de", label: "Deutsch",  flag: "🇩🇪" },
  { code: "en", label: "English",  flag: "🇬🇧" },
  { code: "tr", label: "Türkçe",   flag: "🇹🇷" },
  { code: "ar", label: "العربية",  flag: "🇸🇦" },
  { code: "fr", label: "Français", flag: "🇫🇷" },
  { code: "hi", label: "हिन्दी",   flag: "🇮🇳" },
  { code: "es", label: "Español",  flag: "🇪🇸" },
  { code: "ru", label: "Русский",  flag: "🇷🇺" },
];

// ── Sub-components ─────────────────────────────────────────────────────────────

function SectionHeader({ title }: { title: string }) {
  return (
    <Text className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 mb-3 mt-6">
      {title}
    </Text>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <View
      className="mx-6 bg-white rounded-2xl border border-gray-100 overflow-hidden"
      style={{ shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 6, elevation: 2 }}
    >
      {children}
    </View>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function SettingsScreen() {
  const { t, language, setLanguage } = useTranslation();

  // ── Shared app state (drives Home screen reactively) ──
  const {
    districtId,
    address,
    notificationsEnabled,
    reminderTime,
    districtAutoDetected,
    isLoaded,
    updateDistrict,
    updateNotifications,
    updateReminderTime,
    lastUpdated,
    isRefreshing,
    refreshData,
  } = useAppState();

  // ── UI-only local state ──
  const [hasImportedIcs,     setHasImportedIcs]     = useState(false);
  const [isImporting,        setIsImporting]        = useState(false);
  const [showDistrictPicker, setShowDistrictPicker] = useState(false);
  const [showTimePicker,     setShowTimePicker]     = useState(false);
  const [showLanguagePicker, setShowLanguagePicker] = useState(false);
  const [toastVisible,       setToastVisible]       = useState(false);
  const [toastType,          setToastType]          = useState<"success" | "error" | "info">("success");
  const [toastMsg,           setToastMsg]           = useState("");

  // The "auto-detected" badge mirrors AppState directly.
  const autoDetected = districtAutoDetected;

  // ── Toast helper ───────────────────────────────────────────────────────────
  const showToast = useCallback(
    (msg: string, type: "success" | "error" | "info" = "success") => {
      setToastMsg(msg);
      setToastType(type);
      setToastVisible(true);
      setTimeout(() => setToastVisible(false), 3500);
    },
    []
  );

  // ── Manual data refresh ────────────────────────────────────────────────────
  const handleRefreshData = useCallback(async () => {
    if (isRefreshing) return;
    const result = await refreshData();
    if (result.success) {
      showToast(t("dataUpdated"), "success");
    } else if (result.events.length > 0) {
      showToast(t("dataAlreadyFresh"), "info");
    } else {
      showToast(t("dataUpdateFailed"), "error");
    }
  }, [isRefreshing, refreshData, showToast, t]);

  useEffect(() => {
    if (!isLoaded) return;
    storage.getItem(IMPORTED_ICS_KEY).then((v) => setHasImportedIcs(!!v));
  }, [isLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // Diagnostic: logs every time AppState pushes a new address/Bezirk.
  // Lets us verify in the Metro console that location changes from the Map
  // tab actually reach this screen.
  useEffect(() => {
    if (!isLoaded) return;
    console.info(
      `[Settings] AppState update received:`,
      `\n  Bezirk: ${districtId}`,
      `\n  address: ${address}`,
      `\n  autoDetected: ${districtAutoDetected}`
    );
  }, [districtId, address, districtAutoDetected, isLoaded]);

  // ── Helpers ────────────────────────────────────────────────────────────────

  const makeLabels = () => ({
    "Rest- & Biomüll": t("Rest- & Biomüll"),
    Grüngut:           t("Grüngut"),
    Papiertonne:       t("Papiertonne"),
    "Gelber Sack":     t("Gelber Sack"),
  });

  // ── Manual district select ─────────────────────────────────────────────────
  // Address search & GPS detection live on the Map tab. Settings only exposes
  // the manual Bezirk picker (and notifications/import/language).

  const handleDistrictSelect = async (id: number) => {
    setShowDistrictPicker(false);
    // Manual pick clears the auto-detected flag; address stays.
    await updateDistrict(id, address, false);

    if (notificationsEnabled) {
      const events = await fetchCollectionEvents(id);
      await scheduleReminders(events, reminderTime, 1, makeLabels());
    }
  };

  // ── Notifications ──────────────────────────────────────────────────────────

  const handleToggleNotifications = async (enabled: boolean) => {
    // On web, expo-notifications has no scheduled-push support. We still
    // honour the toggle (so the user's preference persists across native
    // builds and the UI stays responsive), but show a one-time hint.
    if (Platform.OS === "web") {
      await updateNotifications(enabled);
      if (enabled) Alert.alert(t("notifsNotSupported"));
      return;
    }

    if (enabled) {
      try {
        const granted = await requestNotificationPermission();
        if (!granted) {
          Alert.alert(
            t("allowNotifs"),
            Platform.OS === "ios" ? t("iosNotifSettings") : t("androidNotifSettings")
          );
          // Make sure the Switch flips back to off — persist the false value.
          await updateNotifications(false);
          return;
        }
        await updateNotifications(true);
        const events = await fetchCollectionEvents(districtId);
        const scheduled = await scheduleReminders(events, reminderTime, 1, makeLabels());
        Alert.alert(t("notifsActivated"), t("remindersScheduled", { count: scheduled }));
      } catch (err) {
        console.warn("handleToggleNotifications enable error", err);
        await updateNotifications(false);
        Alert.alert(t("notifsActivationError"));
      }
    } else {
      try {
        await updateNotifications(false);
        await cancelAllReminders();
        Alert.alert(t("notifsDeactivated"));
      } catch (err) {
        console.warn("handleToggleNotifications disable error", err);
      }
    }
  };

  const handleReminderTimeSelect = async (time: string) => {
    setShowTimePicker(false);
    await updateReminderTime(time);
    if (notificationsEnabled) {
      const events = await fetchCollectionEvents(districtId);
      await scheduleReminders(events, time, 1, makeLabels());
    }
  };

  // ── ICS import ─────────────────────────────────────────────────────────────

  const handleImportIcs = async () => {
    setIsImporting(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) return;

      const asset = result.assets[0];
      if (!asset.name?.toLowerCase().endsWith(".ics")) {
        Alert.alert(t("calendarImportError"), "Nur .ics-Dateien werden unterstützt.");
        return;
      }

      let content: string;
      if (Platform.OS === "web") {
        const res = await fetch(asset.uri);
        content = await res.text();
      } else {
        content = await FileSystem.readAsStringAsync(asset.uri, {
          encoding: FileSystem.EncodingType.UTF8,
        });
      }

      if (!content.includes("BEGIN:VCALENDAR")) {
        Alert.alert(t("calendarImportError"), "Die Datei enthält keinen gültigen Kalender.");
        return;
      }

      await storage.setItem(IMPORTED_ICS_KEY, content);
      setHasImportedIcs(true);
      Alert.alert(t("calendarImportSuccess"));
    } catch (err) {
      console.warn("ICS import error:", err);
      Alert.alert(t("calendarImportError"));
    } finally {
      setIsImporting(false);
    }
  };

  const handleClearIcs = async () => {
    await storage.removeItem(IMPORTED_ICS_KEY);
    setHasImportedIcs(false);
    Alert.alert(t("calendarImportCleared"));
  };

  // ── Derived ────────────────────────────────────────────────────────────────

  const currentDistrict  = BEZIRKE.find((b) => b.id === districtId)?.name ?? `Bezirk ${districtId}`;
  const currentTimeLabel = REMINDER_TIMES.find((r) => r.value === reminderTime)?.labelKey ?? "time18";

  // ── Render ─────────────────────────────────────────────────────────────────

  // Toast style helpers
  const toastBg      = toastType === "success" ? "#ecfdf5" : toastType === "error" ? "#fef2f2" : "#eff6ff";
  const toastBdr     = toastType === "success" ? "#6ee7b7" : toastType === "error" ? "#fca5a5" : "#93c5fd";
  const toastTxt     = toastType === "success" ? "#065f46" : toastType === "error" ? "#991b1b" : "#1e40af";
  const ToastIcon    = toastType === "error" ? WifiOff : CheckCircle2;
  const toastIconClr = toastType === "success" ? "#059669" : toastType === "error" ? "#dc2626" : "#3b82f6";

  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      {/* In-app toast */}
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
          <ToastIcon size={18} color={toastIconClr} />
          <Text style={{ flex: 1, fontSize: 13, fontWeight: "600", color: toastTxt }} numberOfLines={2}>
            {toastMsg}
          </Text>
        </View>
      )}

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View className="px-6 pt-6 pb-2">
          <Text className="text-3xl font-bold text-gray-900 tracking-tight">
            {t("settings")}
          </Text>
        </View>

        {/* ── District ── */}
        <SectionHeader title={t("districtLabel")} />
        <Card>
          {/* Current address (full text) + hint that detection is on the Map tab.
              Never show raw coordinates here — fall back to nothing instead. */}
          <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4 }}>
            {address && !looksLikeCoordinates(address) ? (
              <Text
                style={{ fontSize: 14, color: "#111827", fontWeight: "600", marginBottom: 6 }}
                numberOfLines={3}
              >
                {address}
              </Text>
            ) : null}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Locate size={14} color="#9ca3af" />
              <Text style={{ fontSize: 12, color: "#6b7280", flex: 1 }}>
                {t("locateHintMap") || "Adresse oder Standort über die Karte einstellen."}
              </Text>
            </View>
            {autoDetected && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 }}>
                <CheckCircle size={13} color="#10b981" />
                <Text style={{ fontSize: 12, color: "#059669", fontWeight: "600" }} numberOfLines={2}>
                  {t("autoDetected")}: {currentDistrict}
                </Text>
              </View>
            )}
          </View>

          {/* Manual district picker */}
          <TouchableOpacity
            onPress={() => setShowDistrictPicker(!showDistrictPicker)}
            style={{ flexDirection: "row", alignItems: "center",
                     paddingHorizontal: 16, paddingVertical: 16,
                     borderTopWidth: 1, borderTopColor: "#f3f4f6" }}
          >
            <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: "#f3f4f6",
                           alignItems: "center", justifyContent: "center", marginRight: 12 }}>
              <MapPin size={18} color="#374151" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: "600", color: "#111827" }}>
                {t("districtLabel")}
              </Text>
              <Text style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }} numberOfLines={1}>
                {currentDistrict}
              </Text>
            </View>
            <ChevronDown
              size={18} color="#6b7280"
              style={{ transform: [{ rotate: showDistrictPicker ? "180deg" : "0deg" }] }}
            />
          </TouchableOpacity>

          {showDistrictPicker && (
            <View style={{ borderTopWidth: 1, borderTopColor: "#f9fafb" }}>
              {BEZIRKE.map((b) => (
                <TouchableOpacity
                  key={b.id}
                  onPress={() => handleDistrictSelect(b.id)}
                  style={{
                    flexDirection: "row", alignItems: "center",
                    paddingHorizontal: 16, paddingVertical: 12,
                    borderBottomWidth: 1, borderBottomColor: "#f9fafb",
                    backgroundColor: b.id === districtId ? "#ecfdf5" : "transparent",
                  }}
                >
                  <Text style={{
                    flex: 1, fontSize: 14,
                    color: b.id === districtId ? "#065f46" : "#374151",
                    fontWeight: b.id === districtId ? "600" : "400",
                  }} numberOfLines={2}>
                    {b.name}
                  </Text>
                  {b.id === districtId && <Text style={{ color: "#059669", fontSize: 16 }}>✓</Text>}
                </TouchableOpacity>
              ))}
            </View>
          )}
        </Card>

        {/* ── Notifications ── */}
        <SectionHeader title={t("reminders")} />
        <Card>
          <View style={{ flexDirection: "row", alignItems: "center",
                         paddingHorizontal: 16, paddingVertical: 16 }}>
            <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: "#f3f4f6",
                           alignItems: "center", justifyContent: "center", marginRight: 12 }}>
              <Bell size={18} color="#374151" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: "600", color: "#111827" }}>
                {t("pushNotifications")}
              </Text>
              <Text style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
                {Platform.OS === "web" ? t("notifsNotSupported") : t("neverMissPickup")}
              </Text>
            </View>
            <Switch
              value={notificationsEnabled}
              onValueChange={handleToggleNotifications}
              trackColor={{ false: "#e5e7eb", true: "#10b981" }}
              thumbColor="#fff"
              // We allow the user to enable/disable on web too — the flag is
              // honoured by native builds. Web just won't actually fire pushes.
            />
          </View>

          {notificationsEnabled && (
            <>
              <TouchableOpacity
                onPress={() => setShowTimePicker(!showTimePicker)}
                style={{ flexDirection: "row", alignItems: "center",
                         paddingHorizontal: 16, paddingVertical: 16,
                         borderTopWidth: 1, borderTopColor: "#f9fafb" }}
              >
                <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: "#f3f4f6",
                               alignItems: "center", justifyContent: "center", marginRight: 12 }}>
                  <Clock size={18} color="#374151" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: "600", color: "#111827" }}>
                    {t("reminderTime")}
                  </Text>
                  <Text style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
                    {t(currentTimeLabel)}
                  </Text>
                </View>
                <ChevronDown
                  size={18} color="#6b7280"
                  style={{ transform: [{ rotate: showTimePicker ? "180deg" : "0deg" }] }}
                />
              </TouchableOpacity>

              {showTimePicker && (
                <View style={{ borderTopWidth: 1, borderTopColor: "#f9fafb" }}>
                  {REMINDER_TIMES.map((rt) => (
                    <TouchableOpacity
                      key={rt.value}
                      onPress={() => handleReminderTimeSelect(rt.value)}
                      style={{
                        flexDirection: "row", alignItems: "center",
                        paddingHorizontal: 16, paddingVertical: 12,
                        borderBottomWidth: 1, borderBottomColor: "#f9fafb",
                        backgroundColor: rt.value === reminderTime ? "#ecfdf5" : "transparent",
                      }}
                    >
                      <Text style={{
                        flex: 1, fontSize: 14,
                        color: rt.value === reminderTime ? "#065f46" : "#374151",
                        fontWeight: rt.value === reminderTime ? "600" : "400",
                      }}>
                        {t(rt.labelKey)}
                      </Text>
                      {rt.value === reminderTime && <Text style={{ color: "#059669" }}>✓</Text>}
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </>
          )}
        </Card>

        {/* ── Data / Refresh ── */}
        <SectionHeader title={t("dataSection")} />
        <Card>
          {/* Last-updated row */}
          <View style={{ flexDirection: "row", alignItems: "center",
                         paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12 }}>
            <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: "#f3f4f6",
                           alignItems: "center", justifyContent: "center", marginRight: 12 }}>
              <Database size={18} color="#374151" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: "600", color: "#111827" }}>
                {t("lastUpdated")}
              </Text>
              <Text style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
                {lastUpdated ? formatAge(lastUpdated, t) : t("neverUpdated")}
              </Text>
            </View>
          </View>

          {/* Refresh button */}
          <View style={{ paddingHorizontal: 16, paddingBottom: 14,
                         borderTopWidth: 1, borderTopColor: "#f9fafb", paddingTop: 12 }}>
            <TouchableOpacity
              onPress={handleRefreshData}
              disabled={isRefreshing}
              style={{
                flexDirection: "row", alignItems: "center", justifyContent: "center",
                gap: 8, backgroundColor: "#10b981", paddingVertical: 12, borderRadius: 12,
                opacity: isRefreshing ? 0.7 : 1,
              }}
            >
              {isRefreshing
                ? <ActivityIndicator size="small" color="#fff" />
                : <RefreshCw size={16} color="#fff" />}
              <Text style={{ color: "#fff", fontWeight: "600", fontSize: 14 }}>
                {isRefreshing ? t("refreshing") : t("refreshData")}
              </Text>
            </TouchableOpacity>
            <Text style={{ fontSize: 11, color: "#9ca3af", textAlign: "center", marginTop: 8 }}>
              {t("manualCalendarImportDesc")}
            </Text>
          </View>
        </Card>

        {/* ── Calendar Import ── */}
        <SectionHeader title={t("manualCalendarImport")} />
        <Card>
          <View style={{ padding: 16 }}>
            <Text style={{ fontSize: 12, color: "#6b7280", marginBottom: 12 }}>
              {t("manualCalendarImportDesc")}
            </Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TouchableOpacity
                onPress={handleImportIcs}
                disabled={isImporting}
                style={{ flex: 1, flexDirection: "row", alignItems: "center",
                         justifyContent: "center", gap: 8,
                         backgroundColor: "#10b981", paddingVertical: 12, borderRadius: 12 }}
              >
                {isImporting
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <FileText size={16} color="#fff" />}
                <Text style={{ color: "#fff", fontWeight: "600", fontSize: 14 }}>
                  {t("importButton")}
                </Text>
              </TouchableOpacity>
              {hasImportedIcs && (
                <TouchableOpacity
                  onPress={handleClearIcs}
                  style={{ backgroundColor: "#fef2f2", borderWidth: 1, borderColor: "#fecaca",
                           paddingHorizontal: 16, borderRadius: 12,
                           alignItems: "center", justifyContent: "center" }}
                >
                  <Trash2 size={16} color="#ef4444" />
                </TouchableOpacity>
              )}
            </View>
            {hasImportedIcs && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 }}>
                <CheckCircle size={13} color="#10b981" />
                <Text style={{ fontSize: 12, color: "#059669" }}>
                  {t("calendarImportSuccess")}
                </Text>
              </View>
            )}
          </View>
        </Card>

        {/* ── Language ── */}
        <SectionHeader title={t("language")} />
        <Card>
          <TouchableOpacity
            onPress={() => setShowLanguagePicker(!showLanguagePicker)}
            style={{ flexDirection: "row", alignItems: "center",
                     paddingHorizontal: 16, paddingVertical: 16 }}
          >
            <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: "#f3f4f6",
                           alignItems: "center", justifyContent: "center", marginRight: 12 }}>
              <Globe size={18} color="#374151" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: "600", color: "#111827" }}>
                {t("language")}
              </Text>
              <Text style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
                {LANGUAGES.find((l) => l.code === language)?.flag}{" "}
                {LANGUAGES.find((l) => l.code === language)?.label}
              </Text>
            </View>
            <ChevronDown
              size={18} color="#6b7280"
              style={{ transform: [{ rotate: showLanguagePicker ? "180deg" : "0deg" }] }}
            />
          </TouchableOpacity>

          {showLanguagePicker && (
            <View style={{ borderTopWidth: 1, borderTopColor: "#f9fafb" }}>
              {LANGUAGES.map((lang, i) => (
                <TouchableOpacity
                  key={lang.code}
                  onPress={() => { setLanguage(lang.code); setShowLanguagePicker(false); }}
                  // Explicit LTR — flag always left, checkmark always right
                  // regardless of any RTL language being active.
                  style={{
                    flexDirection: "row", alignItems: "center",
                    paddingHorizontal: 16, paddingVertical: 12,
                    borderBottomWidth: i < LANGUAGES.length - 1 ? 1 : 0,
                    borderBottomColor: "#f9fafb",
                    backgroundColor: lang.code === language ? "#ecfdf5" : "transparent",
                  }}
                >
                  <Text style={{ fontSize: 20, width: 32 }}>{lang.flag}</Text>
                  <Text style={{
                    flex: 1, fontSize: 14, marginLeft: 8,
                    color: lang.code === language ? "#059669" : "#374151",
                    fontWeight: lang.code === language ? "600" : "400",
                  }}>
                    {lang.label}
                  </Text>
                  {lang.code === language && (
                    <Text style={{ color: "#059669", fontSize: 16, marginLeft: 8 }}>✓</Text>
                  )}
                </TouchableOpacity>
              ))}
            </View>
          )}
        </Card>

        {/* ── About ── */}
        <SectionHeader title={t("aboutApp")} />
        <Card>
          <TouchableOpacity
            onPress={() => Linking.openURL(
              "https://nu.neu-ulm.de/buerger-service/leben-in-neu-ulm/abfall-sauberkeit/abfallkalender/"
            )}
            style={{ flexDirection: "row", alignItems: "center",
                     paddingHorizontal: 16, paddingVertical: 16,
                     borderBottomWidth: 1, borderBottomColor: "#f9fafb" }}
          >
            <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: "#f3f4f6",
                           alignItems: "center", justifyContent: "center", marginRight: 12 }}>
              <ExternalLink size={18} color="#374151" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: "600", color: "#111827" }}>{t("cityWebsite")}</Text>
              <Text style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>nu.neu-ulm.de</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => Linking.openURL("https://ko-fi.com/aminoste")}
            style={{ flexDirection: "row", alignItems: "center",
                     paddingHorizontal: 16, paddingVertical: 16,
                     borderBottomWidth: 1, borderBottomColor: "#f9fafb" }}
          >
            <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: "#f3f4f6",
                           alignItems: "center", justifyContent: "center", marginRight: 12 }}>
              <Text style={{ fontSize: 18 }}>☕</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: "600", color: "#111827" }}>{t("supportOnKofi")}</Text>
              <Text style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>ko-fi.com</Text>
            </View>
          </TouchableOpacity>

          <View style={{ flexDirection: "row", alignItems: "center",
                         paddingHorizontal: 16, paddingVertical: 16 }}>
            <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: "#f3f4f6",
                           alignItems: "center", justifyContent: "center", marginRight: 12 }}>
              <Info size={18} color="#374151" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: "600", color: "#111827" }}>{t("version")}</Text>
              <Text style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>1.4.0</Text>
            </View>
          </View>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}
