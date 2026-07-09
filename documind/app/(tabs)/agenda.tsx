import React from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { CalendarClock, CheckCircle2, CreditCard } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Card, EmptyState, ScreenTitle } from "../../src/components/ui";
import { buildAgenda, groupAgenda, relativeLabel, type AgendaBucket } from "../../src/lib/agendaLogic";
import { listDocuments } from "../../src/lib/storage";
import { colors, font, highlightColor, radius, spacing } from "../../src/lib/theme";
import type { DocumentRecord } from "../../src/lib/types";

const BUCKET_META: Record<AgendaBucket, { title: string; color: string }> = {
  overdue: { title: "Overdue", color: colors.critical },
  soon: { title: "Due within 7 days", color: colors.deadline },
  upcoming: { title: "Upcoming", color: colors.payment },
  undated: { title: "No date", color: colors.textMuted },
};

export default function AgendaScreen() {
  const router = useRouter();
  const [docs, setDocs] = useState<DocumentRecord[]>([]);

  useFocusEffect(
    useCallback(() => {
      listDocuments().then(setDocs);
    }, []),
  );

  const sections = useMemo(() => groupAgenda(buildAgenda(docs)), [docs]);

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
          sections.map((section) => {
            const meta = BUCKET_META[section.key];
            return (
            <View key={section.key} style={{ gap: spacing.sm }}>
              <View style={styles.sectionHeader}>
                <View style={[styles.sectionDot, { backgroundColor: meta.color }]} />
                <Text style={styles.sectionTitle}>{meta.title}</Text>
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
                            <Text style={[styles.itemRel, { color: meta.color }]}>
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
            );
          })
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
