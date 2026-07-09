import React from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { CalendarClock, CheckCircle2, CreditCard } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Card, EmptyState, ScreenTitle } from "../../src/components/ui";
import { listDocuments } from "../../src/lib/storage";
import { colors, font, highlightColor, radius, spacing } from "../../src/lib/theme";
import type { DocumentRecord } from "../../src/lib/types";

interface AgendaItem {
  docId: string;
  docTitle: string;
  type: "deadline" | "payment";
  text: string;
  date?: string;
  amount?: string;
  severity: "low" | "medium" | "high";
}

function buildAgenda(docs: DocumentRecord[]): AgendaItem[] {
  const items: AgendaItem[] = [];
  for (const d of docs) {
    for (const h of d.analysis.highlights) {
      if (h.type === "deadline" || h.type === "payment") {
        items.push({
          docId: d.id,
          docTitle: d.analysis.title || "Untitled",
          type: h.type,
          text: h.text,
          date: h.date,
          amount: h.amount,
          severity: h.severity,
        });
      }
    }
  }
  // dated items ascending, undated last
  return items.sort((a, b) => {
    if (a.date && b.date) return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
    if (a.date) return -1;
    if (b.date) return 1;
    return 0;
  });
}

interface Section {
  key: string;
  title: string;
  color: string;
  items: AgendaItem[];
}

function group(items: AgendaItem[]): Section[] {
  const today = new Date();
  const iso = today.toISOString().slice(0, 10);
  const in7 = new Date(today.getTime() + 7 * 86_400_000).toISOString().slice(0, 10);

  const overdue: AgendaItem[] = [];
  const soon: AgendaItem[] = [];
  const upcoming: AgendaItem[] = [];
  const undated: AgendaItem[] = [];

  for (const it of items) {
    if (!it.date) undated.push(it);
    else if (it.date < iso) overdue.push(it);
    else if (it.date <= in7) soon.push(it);
    else upcoming.push(it);
  }

  return [
    { key: "overdue", title: "Overdue", color: colors.critical, items: overdue },
    { key: "soon", title: "Due within 7 days", color: colors.deadline, items: soon },
    { key: "upcoming", title: "Upcoming", color: colors.payment, items: upcoming },
    { key: "undated", title: "No date", color: colors.textMuted, items: undated },
  ].filter((s) => s.items.length > 0);
}

function relativeLabel(date?: string): string {
  if (!date) return "";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(`${date}T00:00:00`);
  const days = Math.round((d.getTime() - today.getTime()) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  if (days < 0) return `${-days} days ago`;
  return `in ${days} days`;
}

export default function AgendaScreen() {
  const router = useRouter();
  const [docs, setDocs] = useState<DocumentRecord[]>([]);

  useFocusEffect(
    useCallback(() => {
      listDocuments().then(setDocs);
    }, []),
  );

  const sections = useMemo(() => group(buildAgenda(docs)), [docs]);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <ScreenTitle
          title="Agenda"
          subtitle="Every deadline and payment across your documents, in one timeline."
        />

        {sections.length === 0 ? (
          <Card>
            <EmptyState
              icon={<CheckCircle2 color={colors.ok} size={40} />}
              title="Nothing due"
              subtitle="No deadlines or payments detected yet. Scan a document and DocuMind will surface them here."
            />
          </Card>
        ) : (
          sections.map((section) => (
            <View key={section.key} style={{ gap: spacing.sm }}>
              <View style={styles.sectionHeader}>
                <View style={[styles.sectionDot, { backgroundColor: section.color }]} />
                <Text style={styles.sectionTitle}>{section.title}</Text>
                <Text style={styles.sectionCount}>{section.items.length}</Text>
              </View>
              {section.items.map((it, i) => {
                const c = highlightColor[it.type];
                const Icon = it.type === "deadline" ? CalendarClock : CreditCard;
                return (
                  <Pressable
                    key={`${it.docId}-${i}`}
                    onPress={() => router.push(`/document/${it.docId}`)}
                    style={({ pressed }) => pressed && { opacity: 0.9 }}
                  >
                    <Card style={[styles.item, { borderLeftColor: c, borderLeftWidth: 4 }]}>
                      <View style={[styles.itemIcon, { backgroundColor: c + "1A" }]}>
                        <Icon color={c} size={18} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.itemText} numberOfLines={2}>
                          {it.text}
                        </Text>
                        <Text style={styles.itemMeta} numberOfLines={1}>
                          {it.docTitle}
                        </Text>
                      </View>
                      <View style={styles.itemRight}>
                        {it.amount ? <Text style={styles.itemAmount}>{it.amount}</Text> : null}
                        {it.date ? (
                          <>
                            <Text style={styles.itemDate}>{it.date}</Text>
                            <Text style={[styles.itemRel, { color: section.color }]}>
                              {relativeLabel(it.date)}
                            </Text>
                          </>
                        ) : null}
                      </View>
                    </Card>
                  </Pressable>
                );
              })}
            </View>
          ))
        )}
        <View style={{ height: spacing.xxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, gap: spacing.lg },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  sectionDot: { width: 9, height: 9, borderRadius: 5 },
  sectionTitle: { fontSize: font.small, fontWeight: "800", color: colors.text, textTransform: "uppercase", letterSpacing: 0.4 },
  sectionCount: { fontSize: font.tiny, color: colors.textFaint, fontWeight: "700" },
  item: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  itemIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  itemText: { fontSize: font.body, color: colors.text, fontWeight: "600" },
  itemMeta: { fontSize: font.small, color: colors.textMuted, marginTop: 2 },
  itemRight: { alignItems: "flex-end" },
  itemAmount: { fontSize: font.small, fontWeight: "800", color: colors.text },
  itemDate: { fontSize: font.tiny, color: colors.textMuted, marginTop: 2 },
  itemRel: { fontSize: font.tiny, fontWeight: "700" },
});
