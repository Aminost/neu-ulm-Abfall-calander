import { useRouter } from "expo-router";
import { useFocusEffect } from "expo-router";
import { AlertTriangle, CalendarClock, FileText, Inbox, Search } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
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
import { listDocuments } from "../../src/lib/storage";
import { colors, font, radius, severityWeight, spacing } from "../../src/lib/theme";
import type { DocumentRecord, Highlight } from "../../src/lib/types";

function topHighlights(doc: DocumentRecord): Highlight[] {
  return [...doc.analysis.highlights]
    .sort((a, b) => severityWeight[b.severity] - severityWeight[a.severity])
    .slice(0, 3);
}

function nextDeadline(docs: DocumentRecord[]): { text: string; date: string } | null {
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = docs
    .flatMap((d) => d.analysis.highlights)
    .filter((h) => h.type === "deadline" && h.date && h.date >= today)
    .sort((a, b) => (a.date! < b.date! ? -1 : 1));
  return upcoming[0] ? { text: upcoming[0].text, date: upcoming[0].date! } : null;
}

export default function LibraryScreen() {
  const router = useRouter();
  const [docs, setDocs] = useState<DocumentRecord[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState<string | null>(null);

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

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const deadline = nextDeadline(docs);
  const criticalCount = docs
    .flatMap((d) => d.analysis.highlights)
    .filter((h) => h.type === "critical").length;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
        }
      >
        <ScreenTitle title="Library" subtitle={`${docs.length} document${docs.length === 1 ? "" : "s"} digitized`} />

        {(deadline || criticalCount > 0) && (
          <View style={styles.alertRow}>
            {deadline && (
              <Card style={styles.alertCard}>
                <CalendarClock color={colors.deadline} size={18} />
                <Text style={styles.alertLabel}>Next deadline</Text>
                <Text style={styles.alertValue} numberOfLines={2}>
                  {deadline.text}
                </Text>
                <Text style={styles.alertDate}>{deadline.date}</Text>
              </Card>
            )}
            {criticalCount > 0 && (
              <Card style={styles.alertCard}>
                <AlertTriangle color={colors.critical} size={18} />
                <Text style={styles.alertLabel}>Critical items</Text>
                <Text style={[styles.alertValue, { color: colors.critical }]}>
                  {criticalCount} need attention
                </Text>
              </Card>
            )}
          </View>
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
  alertRow: { flexDirection: "row", gap: spacing.md, marginBottom: spacing.xs },
  alertCard: { flex: 1, gap: 4, paddingVertical: spacing.md },
  alertLabel: { fontSize: font.tiny, color: colors.textMuted, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.4 },
  alertValue: { fontSize: font.body, color: colors.text, fontWeight: "700" },
  alertDate: { fontSize: font.small, color: colors.deadline, fontWeight: "600" },
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
