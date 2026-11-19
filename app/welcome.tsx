/**
 * Welcome / first-run flow.
 *
 * The app has no accounts — instead of a login, new users go through three
 * quick steps that configure everything the app needs:
 *   1. Language
 *   2. Address → Abfuhrbezirk (GPS, address search, or manual pick)
 *   3. Reminders (native only)
 */
import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  ScrollView,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  Platform,
  KeyboardAvoidingView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import {
  CalendarCheck,
  BellRing,
  MapPin,
  Locate,
  Search,
  CheckCircle2,
  ChevronLeft,
  ShieldCheck,
} from "lucide-react-native";
import AppLogo from "../components/AppLogo";
import { useTranslation, type Language } from "../lib/i18n";
import { useAppState } from "../lib/appState";
import { BEZIRKE } from "../lib/constants";
import {
  searchAddress,
  formatNominatimAddress,
  type NominatimResult,
} from "../lib/dataFetcher";
import {
  detectDistrictFromAddress,
  detectDistrictFromCoordinates,
} from "../lib/districtDetector";
import { locateDistrict, LocateError } from "../lib/locate";
import { requestNotificationPermission } from "../lib/notificationScheduler";

const GREEN = "#059669";
const GREEN_DARK = "#047857";

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

const TIMES = [
  { value: "18:00", key: "time18" },
  { value: "19:00", key: "time19" },
  { value: "20:00", key: "time20" },
  { value: "06:00", key: "time06" },
];

interface Selection {
  districtId: number;
  address: string;
  coords: [number, number] | null;
}

export default function WelcomeScreen() {
  const { t, language, setLanguage } = useTranslation();
  const {
    applyDetectedLocation,
    updateDistrict,
    updateNotifications,
    updateReminderTime,
    completeOnboarding,
  } = useAppState();

  const totalSteps = Platform.OS === "web" ? 2 : 3;
  const [step, setStep] = useState(0);

  // Step 2 state
  const [selection, setSelection] = useState<Selection | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<NominatimResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchSeq = useRef(0);

  // Step 3 state
  const [time, setTime] = useState("18:00");
  const [finishing, setFinishing] = useState(false);

  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  // ── Debounced address search ──────────────────────────────────────────────
  const onChangeQuery = (text: string) => {
    setQuery(text);
    setError(null);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (text.trim().length < 3) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      const seq = ++searchSeq.current;
      try {
        const found = await searchAddress(text.trim());
        if (seq !== searchSeq.current) return;
        setResults(found.slice(0, 5));
        if (found.length === 0) setError(t("addressNotFound"));
      } catch {
        if (seq === searchSeq.current) setError(t("searchError"));
      } finally {
        if (seq === searchSeq.current) setSearching(false);
      }
    }, 500);
  };

  useEffect(() => () => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
  }, []);

  const pickResult = (r: NominatimResult) => {
    const lat = parseFloat(r.lat);
    const lon = parseFloat(r.lon);
    const id =
      detectDistrictFromAddress(r.address, lat, lon) ??
      detectDistrictFromCoordinates(lat, lon);
    const label = formatNominatimAddress(r.address, r.display_name);
    setResults([]);
    setQuery(label);
    if (id === null) {
      setError(t("addressNotInRegion"));
      return;
    }
    setSelection({ districtId: id, address: label, coords: [lat, lon] });
  };

  const handleLocate = async () => {
    setLocating(true);
    setError(null);
    setResults([]);
    try {
      const res = await locateDistrict();
      if (res.districtId === null) {
        setError(t("outsideRegionTitle"));
        return;
      }
      const label = res.address || t("currentLocation");
      setQuery(label);
      setSelection({ districtId: res.districtId, address: label, coords: res.coords });
    } catch (err) {
      setError(err instanceof LocateError ? t(err.message) : t("genericLocationError"));
    } finally {
      setLocating(false);
    }
  };

  // ── Persist + finish ──────────────────────────────────────────────────────
  const saveDistrict = async () => {
    if (!selection) return;
    if (selection.coords) {
      await applyDetectedLocation({
        districtId: selection.districtId,
        address: selection.address,
        coords: selection.coords,
        autoDetected: true,
      });
    } else {
      await updateDistrict(selection.districtId, "", false);
    }
  };

  const finish = async (withReminders: boolean) => {
    setFinishing(true);
    try {
      await saveDistrict();
      if (withReminders) {
        const granted = await requestNotificationPermission();
        await updateReminderTime(time);
        await updateNotifications(granted);
      }
      await completeOnboarding();
      router.replace("/");
    } catch (err) {
      console.warn("[Welcome] finish failed:", err);
      setFinishing(false);
    }
  };

  const next = () => {
    if (step === 1 && Platform.OS === "web") {
      void finish(false);
      return;
    }
    setStep((s) => s + 1);
  };

  const district = selection ? BEZIRKE.find((b) => b.id === selection.districtId) : null;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <View style={styles.root}>
      {/* Decorative background blobs */}
      <View style={[styles.blob, { top: -120, right: -80, width: 300, height: 300 }]} />
      <View style={[styles.blob, { top: 160, left: -140, width: 260, height: 260, opacity: 0.08 }]} />

      <SafeAreaView style={{ flex: 1 }} edges={["top", "bottom"]}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          {/* Top bar: back + progress */}
          <View style={styles.topBar}>
            {step > 0 ? (
              <Pressable
                onPress={() => setStep((s) => s - 1)}
                hitSlop={12}
                style={styles.backBtn}
                accessibilityRole="button"
                accessibilityLabel={t("backBtn")}
              >
                <ChevronLeft size={22} color="#fff" />
              </Pressable>
            ) : (
              <View style={{ width: 36 }} />
            )}
            <View style={styles.dots}>
              {Array.from({ length: totalSteps }).map((_, i) => (
                <View key={i} style={[styles.dot, i === step && styles.dotActive]} />
              ))}
            </View>
            <View style={{ width: 36 }} />
          </View>

          {step === 0 && (
            <View style={{ flex: 1 }}>
              <View style={styles.hero}>
                <View style={styles.logoShadow}>
                  <AppLogo size={112} />
                </View>
                <Text style={styles.heroTitle}>{t("welcomeTitle")}</Text>
                <Text style={styles.heroSub}>{t("welcomeSubtitle")}</Text>
              </View>

              <View style={styles.sheet}>
                <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 8 }}>
                  <Feature Icon={CalendarCheck} text={t("featureCalendar")} />
                  <Feature Icon={BellRing} text={t("featureReminders")} />
                  <Feature Icon={MapPin} text={t("featureMap")} />

                  <Text style={styles.label}>{t("language")}</Text>
                  <View style={styles.langGrid}>
                    {LANGUAGES.map((l) => {
                      const active = l.code === language;
                      return (
                        <Pressable
                          key={l.code}
                          onPress={() => setLanguage(l.code)}
                          style={[styles.langChip, active && styles.langChipActive]}
                          accessibilityRole="radio"
                          accessibilityState={{ selected: active }}
                        >
                          <Text style={{ fontSize: 16 }}>{l.flag}</Text>
                          <Text style={[styles.langText, active && { color: GREEN_DARK }]}>
                            {l.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </ScrollView>
                <View style={styles.footer}>
                  <PrimaryButton label={t("getStarted")} onPress={next} />
                  <View style={styles.privacy}>
                    <ShieldCheck size={14} color="#6b7280" />
                    <Text style={styles.privacyText}>{t("privacyNote")}</Text>
                  </View>
                </View>
              </View>
            </View>
          )}

          {step === 1 && (
            <View style={{ flex: 1 }}>
              <View style={styles.stepHeader}>
                <Text style={styles.stepKicker}>
                  {t("stepOf", { n: 2, total: totalSteps })}
                </Text>
                <Text style={styles.stepTitle}>{t("whereDoYouLive")}</Text>
                <Text style={styles.stepSub}>{t("whereDoYouLiveDesc")}</Text>
              </View>

              <View style={styles.sheet}>
                <ScrollView
                  contentContainerStyle={{ padding: 24, paddingBottom: 8 }}
                  keyboardShouldPersistTaps="handled"
                >
                  <Pressable
                    onPress={handleLocate}
                    disabled={locating}
                    style={({ pressed }) => [styles.locateBtn, pressed && { opacity: 0.85 }]}
                    accessibilityRole="button"
                  >
                    {locating ? (
                      <ActivityIndicator color={GREEN} />
                    ) : (
                      <Locate size={20} color={GREEN} />
                    )}
                    <Text style={styles.locateText}>
                      {locating ? t("locating") : t("useMyLocation")}
                    </Text>
                  </Pressable>

                  <Text style={styles.divider}>{t("orSearchAddress")}</Text>

                  <View style={styles.inputWrap}>
                    <Search size={18} color="#9ca3af" />
                    <TextInput
                      value={query}
                      onChangeText={onChangeQuery}
                      placeholder={t("streetPlaceholder")}
                      placeholderTextColor="#9ca3af"
                      style={styles.input}
                      autoCorrect={false}
                      returnKeyType="search"
                    />
                    {searching && <ActivityIndicator size="small" color={GREEN} />}
                  </View>

                  {results.length > 0 && (
                    <View style={styles.results}>
                      {results.map((r, i) => (
                        <Pressable
                          key={`${r.lat},${r.lon},${i}`}
                          onPress={() => pickResult(r)}
                          style={({ pressed }) => [
                            styles.resultRow,
                            i > 0 && styles.resultBorder,
                            pressed && { backgroundColor: "#f0fdf4" },
                          ]}
                        >
                          <MapPin size={16} color="#6b7280" />
                          <Text style={styles.resultText} numberOfLines={2}>
                            {formatNominatimAddress(r.address, r.display_name)}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  )}

                  {error && <Text style={styles.error}>{error}</Text>}

                  {district && (
                    <View style={styles.selected}>
                      <CheckCircle2 size={22} color={GREEN} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.selectedLabel}>{t("districtLabel")}</Text>
                        <Text style={styles.selectedName}>{district.name}</Text>
                      </View>
                    </View>
                  )}

                  <Text style={[styles.label, { marginTop: 20 }]}>{t("orChooseDistrict")}</Text>
                  <View style={styles.districtGrid}>
                    {BEZIRKE.map((b) => {
                      const active = selection?.districtId === b.id;
                      return (
                        <Pressable
                          key={b.id}
                          onPress={() => {
                            setError(null);
                            setSelection({ districtId: b.id, address: "", coords: null });
                          }}
                          style={[styles.districtChip, active && styles.districtChipActive]}
                          accessibilityRole="radio"
                          accessibilityState={{ selected: active }}
                        >
                          <Text style={[styles.districtNum, active && { color: "#fff" }]}>
                            {b.id}
                          </Text>
                          <Text
                            style={[styles.districtText, active && { color: "#fff" }]}
                            numberOfLines={2}
                          >
                            {b.name.replace(/^Bezirk \d+:\s*/, "")}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </ScrollView>
                <View style={styles.footer}>
                  <PrimaryButton
                    label={t("continueBtn")}
                    onPress={next}
                    disabled={!selection || finishing}
                    loading={finishing}
                  />
                </View>
              </View>
            </View>
          )}

          {step === 2 && (
            <View style={{ flex: 1 }}>
              <View style={styles.stepHeader}>
                <View style={styles.bellBadge}>
                  <BellRing size={36} color="#fff" />
                </View>
                <Text style={styles.stepKicker}>
                  {t("stepOf", { n: 3, total: totalSteps })}
                </Text>
                <Text style={styles.stepTitle}>{t("remindersTitle")}</Text>
                <Text style={styles.stepSub}>{t("remindersDesc")}</Text>
              </View>

              <View style={styles.sheet}>
                <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 8 }}>
                  <Text style={styles.label}>{t("reminderTime")}</Text>
                  {TIMES.map((o) => {
                    const active = o.value === time;
                    return (
                      <Pressable
                        key={o.value}
                        onPress={() => setTime(o.value)}
                        style={[styles.timeRow, active && styles.timeRowActive]}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: active }}
                      >
                        <Text style={[styles.timeText, active && { color: GREEN_DARK }]}>
                          {t(o.key)}
                        </Text>
                        <View style={[styles.radio, active && styles.radioActive]}>
                          {active && <View style={styles.radioDot} />}
                        </View>
                      </Pressable>
                    );
                  })}
                </ScrollView>
                <View style={styles.footer}>
                  <PrimaryButton
                    label={t("enableReminders")}
                    onPress={() => finish(true)}
                    disabled={finishing}
                    loading={finishing}
                  />
                  <Pressable
                    onPress={() => finish(false)}
                    disabled={finishing}
                    style={styles.secondaryBtn}
                    accessibilityRole="button"
                  >
                    <Text style={styles.secondaryText}>{t("maybeLater")}</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

// ── Small components ──────────────────────────────────────────────────────────

function Feature({ Icon, text }: { Icon: typeof MapPin; text: string }) {
  return (
    <View style={styles.feature}>
      <View style={styles.featureIcon}>
        <Icon size={18} color={GREEN} />
      </View>
      <Text style={styles.featureText}>{text}</Text>
    </View>
  );
}

function PrimaryButton({
  label,
  onPress,
  disabled,
  loading,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.primaryBtn,
        disabled && { opacity: 0.45 },
        pressed && !disabled && { backgroundColor: GREEN_DARK },
      ]}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
    >
      {loading ? (
        <ActivityIndicator color="#fff" />
      ) : (
        <Text style={styles.primaryText}>{label}</Text>
      )}
    </Pressable>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#059669", overflow: "hidden" },
  blob: {
    position: "absolute",
    borderRadius: 999,
    backgroundColor: "#ffffff",
    opacity: 0.1,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 8,
    height: 48,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  dots: { flexDirection: "row", gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "rgba(255,255,255,0.4)" },
  dotActive: { width: 24, backgroundColor: "#fff" },

  hero: { alignItems: "center", paddingHorizontal: 32, paddingTop: 12, paddingBottom: 28 },
  logoShadow: {
    borderRadius: 28,
    shadowColor: "#022c22",
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
    marginBottom: 20,
  },
  heroTitle: { color: "#fff", fontSize: 26, fontWeight: "800", textAlign: "center" },
  heroSub: {
    color: "#d1fae5",
    fontSize: 15,
    lineHeight: 21,
    textAlign: "center",
    marginTop: 8,
  },

  stepHeader: { alignItems: "center", paddingHorizontal: 32, paddingTop: 8, paddingBottom: 24 },
  stepKicker: {
    color: "#a7f3d0",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  stepTitle: { color: "#fff", fontSize: 26, fontWeight: "800", marginTop: 6, textAlign: "center" },
  stepSub: { color: "#d1fae5", fontSize: 15, marginTop: 6, textAlign: "center", lineHeight: 21 },
  bellBadge: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },

  sheet: {
    flex: 1,
    backgroundColor: "#fff",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    overflow: "hidden",
  },
  footer: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 16 },

  feature: { flexDirection: "row", alignItems: "center", marginBottom: 14 },
  featureIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: "#ecfdf5",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  featureText: { flex: 1, fontSize: 15, color: "#1f2937", fontWeight: "500" },

  label: {
    fontSize: 12,
    fontWeight: "700",
    color: "#6b7280",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginTop: 8,
    marginBottom: 10,
  },
  langGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  langChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#e5e7eb",
    backgroundColor: "#fff",
  },
  langChipActive: { borderColor: GREEN, backgroundColor: "#ecfdf5" },
  langText: { fontSize: 14, color: "#374151", fontWeight: "600" },

  primaryBtn: {
    height: 54,
    borderRadius: 16,
    backgroundColor: GREEN,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryText: { color: "#fff", fontSize: 17, fontWeight: "700" },
  secondaryBtn: { height: 46, alignItems: "center", justifyContent: "center", marginTop: 4 },
  secondaryText: { color: "#6b7280", fontSize: 15, fontWeight: "600" },
  privacy: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 12,
  },
  privacyText: { fontSize: 12, color: "#6b7280", flexShrink: 1, textAlign: "center" },

  locateBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    height: 54,
    borderRadius: 16,
    backgroundColor: "#ecfdf5",
    borderWidth: 1.5,
    borderColor: "#a7f3d0",
  },
  locateText: { color: GREEN_DARK, fontSize: 16, fontWeight: "700" },
  divider: { textAlign: "center", color: "#9ca3af", fontSize: 13, marginVertical: 14 },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    height: 52,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: "#f9fafb",
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  input: { flex: 1, fontSize: 16, color: "#111827", paddingVertical: 0 },
  results: {
    marginTop: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    overflow: "hidden",
  },
  resultRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14 },
  resultBorder: { borderTopWidth: 1, borderTopColor: "#f3f4f6" },
  resultText: { flex: 1, fontSize: 14, color: "#1f2937" },
  error: { color: "#dc2626", fontSize: 13, marginTop: 10 },

  selected: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 16,
    padding: 14,
    borderRadius: 14,
    backgroundColor: "#ecfdf5",
  },
  selectedLabel: { fontSize: 12, color: "#047857", fontWeight: "600" },
  selectedName: { fontSize: 15, color: "#064e3b", fontWeight: "700", marginTop: 2 },

  districtGrid: { gap: 8 },
  districtChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: "#e5e7eb",
  },
  districtChipActive: { backgroundColor: GREEN, borderColor: GREEN },
  districtNum: {
    width: 28,
    fontSize: 18,
    fontWeight: "800",
    color: GREEN,
    textAlign: "center",
  },
  districtText: { flex: 1, fontSize: 14, color: "#374151", fontWeight: "500" },

  timeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: "#e5e7eb",
    marginBottom: 8,
  },
  timeRowActive: { borderColor: GREEN, backgroundColor: "#ecfdf5" },
  timeText: { fontSize: 15, color: "#374151", fontWeight: "600" },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: "#d1d5db",
    alignItems: "center",
    justifyContent: "center",
  },
  radioActive: { borderColor: GREEN },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: GREEN },
});
