import React from "react";
import { useRouter } from "expo-router";
import { useFocusEffect } from "expo-router";
import { AlertTriangle, CalendarClock, CreditCard, FileText, Inbox, Search } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Badge, Card, EmptyState, Pill, ScreenTitle } from "../../src/components/ui";
import { fetchServerDocuments } from "../../src/api/client";
import { dashboardStats } from "../../src/lib/agendaLogic";
import { getSettings, listDocuments, mergeRestored } from "../../src/lib/storage";
import { colors, font, radius, severityWeight, spacing } from "../../src/lib/theme";
import type { DocumentRecord, Highlight } from "../../src/lib/types";

function topHighlights(doc: DocumentRecord): Highlight[] {
  return [...doc.analysis.highlights]
    .sort((a, b) => severityWeight[b.severity] - severityWeight[a.severity])
    .slice(0, 3);
}

export default function LibraryScreen() {
  const router = useRouter();
  const [docs, setDocs] = useState<DocumentRecord[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // First launch → onboarding.
  useEffect(() => {
    getSettings().then((s) => {
      if (!s.onboarded) router.replace("/onboarding");
      else setReady(true);
    });
  }, [router]);

  const categories = useMemo(
    () => [...new Set(docs.map((d) => d.analysis.category))].sort(),
    [docs],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return docs.filter((d) => {
      if (cat && d.analysis.category !== cat) return false;
      if (!q) return true;
      const hay = [
        d.analysis.title,
        d.analysis.summary,
        d.analysis.category,
        ...d.analysis.highlights.map((h) => h.text),
        ...d.analysis.entities.map((e) => e.name),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [docs, query, cat]);

  const load = useCallback(async () => {
    setDocs(await listDocuments());
  }, []);

  // Silently pull any documents added on other devices, so the library stays
  // current everywhere without a manual restore. Offline / no-backend is ignored.
  const backgroundSync = useCallback(async () => {
    try {
      const remote = await fetchServerDocuments();
      const added = await mergeRestored(remote);
      if (added.length > 0) await load();
    } catch {
      /* backend unreachable — keep showing local documents */
    }
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      load();
      backgroundSync();
    }, [load, backgroundSync]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const { upcomingCount, paymentsCount, criticalCount, nextDeadline: deadline } =
    dashboardStats(docs);

  if (!ready) return <SafeAreaView style={styles.safe} edges={["top"]} />;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
        }
      >
        <ScreenTitle title="Library" subtitle={`${docs.length} document${docs.length === 1 ? "" : "s"} digitized`} />

        {docs.length > 0 && (
          <View style={styles.statRow}>
            <StatCard label="Upcoming" value={upcomingCount} color={colors.deadline} icon={<CalendarClock color={colors.deadline} size={16} />} />
            <StatCard label="Payments" value={paymentsCount} color={colors.payment} icon={<CreditCard color={colors.payment} size={16} />} />
            <StatCard label="Critical" value={criticalCount} color={colors.critical} icon={<AlertTriangle color={colors.critical} size={16} />} />
          </View>
        )}

        {deadline && (
          <Card style={styles.heroCard}>
            <CalendarClock color={colors.deadline} size={18} />
            <View style={{ flex: 1 }}>
              <Text style={styles.alertLabel}>Next deadline · {deadline.date}</Text>
              <Text style={styles.heroValue} numberOfLines={2}>
                {deadline.text}
              </Text>
            </View>
          </Card>
        )}

        {docs.length > 0 && (
          <>
            <View style={styles.searchBar}>
              <Search color={colors.textFaint} size={18} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search documents, amounts, names…"
                placeholderTextColor={colors.textFaint}
                value={query}
                onChangeText={setQuery}
                autoCapitalize="none"
              />
            </View>
            {categories.length > 1 && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chips}
              >
                <FilterChip label="All" active={cat === null} onPress={() => setCat(null)} />
                {categories.map((c) => (
                  <FilterChip key={c} label={c} active={cat === c} onPress={() => setCat(c)} />
                ))}
              </ScrollView>
            )}
          </>
        )}

        {docs.length === 0 ? (
          <Card style={{ marginTop: spacing.lg }}>
            <EmptyState
              icon={<Inbox color={colors.textFaint} size={40} />}
              title="No documents yet"
              subtitle="Go to Scan to capture or import your first document. DocuMind will read it, sort it, and flag deadlines & payments."
            />
          </Card>
        ) : filtered.length === 0 ? (
          <Card style={{ marginTop: spacing.lg }}>
            <EmptyState
              icon={<Search color={colors.textFaint} size={36} />}
              title="No matches"
              subtitle="Try a different search term or category."
            />
          </Card>
        ) : (
          filtered.map((doc) => (
            <Pressable
              key={doc.id}
              onPress={() => router.push(`/document/${doc.id}`)}
              style={({ pressed }) => pressed && { opacity: 0.9 }}
            >
              <Card style={styles.docCard}>
                <View style={styles.docHeader}>
                  <View style={styles.docIcon}>
                    <FileText color={colors.accent} size={20} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.docTitle} numberOfLines={1}>
                      {doc.analysis.title || "Untitled document"}
                    </Text>
                    <Text style={styles.docMeta}>
                      {new Date(doc.createdAt).toLocaleDateString()}
                    </Text>
                  </View>
                  <Pill label={doc.analysis.category || "Other"} />
                </View>

                {doc.analysis.summary ? (
                  <Text style={styles.docSummary} numberOfLines={2}>
                    {doc.analysis.summary}
                  </Text>
                ) : null}

                {topHighlights(doc).length > 0 && (
                  <View style={styles.badgeRow}>
                    {topHighlights(doc).map((h) => (
                      <Badge key={h.id} type={h.type} />
                    ))}
                  </View>
                )}
              </Card>
            </Pressable>
          ))
        )}
        <View style={{ height: spacing.xxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function StatCard({
  label,
  value,
  color,
  icon,
}: {
  label: string;
  value: number;
  color: string;
  icon: React.ReactNode;
}) {
  return (
    <Card style={styles.statCard}>
      {icon}
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </Card>
  );
}

function FilterChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && { color: colors.white }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, gap: spacing.md },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  searchInput: { flex: 1, paddingVertical: spacing.md, fontSize: font.body, color: colors.text },
  chips: { gap: spacing.sm, paddingVertical: spacing.xs },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { fontSize: font.small, color: colors.textMuted, fontWeight: "600" },
  alertLabel: { fontSize: font.tiny, color: colors.textMuted, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.4 },
  statRow: { flexDirection: "row", gap: spacing.md },
  statCard: { flex: 1, alignItems: "center", gap: 2, paddingVertical: spacing.md },
  statValue: { fontSize: font.h2, fontWeight: "800" },
  statLabel: { fontSize: font.tiny, color: colors.textMuted, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.3 },
  heroCard: { flexDirection: "row", gap: spacing.md, alignItems: "center" },
  heroValue: { fontSize: font.body, color: colors.text, fontWeight: "700", marginTop: 2 },
  docCard: { gap: spacing.sm },
  docHeader: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  docIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  docTitle: { fontSize: font.h3, fontWeight: "700", color: colors.text },
  docMeta: { fontSize: font.small, color: colors.textFaint },
  docSummary: { fontSize: font.body, color: colors.textMuted, lineHeight: 21 },
  badgeRow: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap", marginTop: 2 },
});
