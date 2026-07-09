import React from "react";
import * as Sharing from "expo-sharing";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ArrowLeft,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronUp,
  CreditCard,
  FileDown,
  Flag,
  Pencil,
  Trash2,
  Zap,
} from "lucide-react-native";
import { useEffect, useState } from "react";
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Card, Pill } from "../../src/components/ui";
import { deleteServerDocument, upsertDocument } from "../../src/api/client";
import { deleteDocument, getDocument, saveDocument } from "../../src/lib/storage";
import {
  colors,
  font,
  highlightColor,
  highlightLabel,
  radius,
  severityWeight,
  spacing,
} from "../../src/lib/theme";
import { CATEGORIES } from "../../src/lib/types";
import type { DocumentRecord, Highlight, HighlightType } from "../../src/lib/types";

const ICONS: Record<HighlightType, React.ComponentType<{ color: string; size: number }>> = {
  deadline: CalendarClock,
  payment: CreditCard,
  critical: Zap,
  action: Flag,
};

export default function DocumentDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [doc, setDoc] = useState<DocumentRecord | undefined>();
  const [showText, setShowText] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editCategory, setEditCategory] = useState("");

  useEffect(() => {
    if (id) getDocument(id).then(setDoc);
  }, [id]);

  function startEdit() {
    if (!doc) return;
    setEditTitle(doc.analysis.title);
    setEditCategory(doc.analysis.category);
    setEditing(true);
  }

  async function saveEdit() {
    if (!doc) return;
    const updated: DocumentRecord = {
      ...doc,
      analysis: { ...doc.analysis, title: editTitle.trim() || "Untitled document", category: editCategory },
    };
    setDoc(updated);
    setEditing(false);
    await saveDocument(updated);
    upsertDocument({
      id: updated.id,
      title: updated.analysis.title,
      createdAt: updated.createdAt,
      analysis: updated.analysis,
    }).catch(() => {});
  }

  async function openPdf() {
    if (!doc?.pdfUri) return;
    try {
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(doc.pdfUri, { mimeType: "application/pdf", UTI: "com.adobe.pdf" });
      } else {
        Alert.alert("Sharing unavailable", "PDF sharing isn't supported on this platform.");
      }
    } catch (e) {
      Alert.alert("Couldn't open PDF", e instanceof Error ? e.message : String(e));
    }
  }

  function confirmDelete() {
    Alert.alert("Delete document", "This removes it from your device and the chat index.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          if (!id) return;
          await deleteDocument(id);
          deleteServerDocument(id).catch(() => {});
          router.back();
        },
      },
    ]);
  }

  if (!doc) {
    return (
      <SafeAreaView style={styles.safe}>
        <Text style={styles.loading}>Loading…</Text>
      </SafeAreaView>
    );
  }

  const { analysis } = doc;
  const highlights = [...analysis.highlights].sort(
    (a, b) => severityWeight[b.severity] - severityWeight[a.severity],
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.iconBtn}>
          <ArrowLeft color={colors.text} size={22} />
        </Pressable>
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          {editing ? (
            <Pressable onPress={saveEdit} hitSlop={12} style={[styles.iconBtn, styles.saveBtn]}>
              <Check color={colors.white} size={20} />
            </Pressable>
          ) : (
            <Pressable onPress={startEdit} hitSlop={12} style={styles.iconBtn}>
              <Pencil color={colors.text} size={19} />
            </Pressable>
          )}
          <Pressable onPress={confirmDelete} hitSlop={12} style={styles.iconBtn}>
            <Trash2 color={colors.critical} size={20} />
          </Pressable>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {doc.imageUri ? (
          <Image source={{ uri: doc.imageUri }} style={styles.hero} resizeMode="cover" />
        ) : null}

        <View style={styles.titleRow}>
          {editing ? (
            <TextInput
              style={styles.titleInput}
              value={editTitle}
              onChangeText={setEditTitle}
              placeholder="Document title"
              placeholderTextColor={colors.textFaint}
              multiline
            />
          ) : (
            <Text style={styles.title}>{analysis.title || "Untitled document"}</Text>
          )}
        </View>

        {editing ? (
          <View style={styles.catRow}>
            {CATEGORIES.map((c) => {
              const active = c === editCategory;
              return (
                <Pressable
                  key={c}
                  onPress={() => setEditCategory(c)}
                  style={[styles.catChip, active && styles.catChipActive]}
                >
                  <Text style={[styles.catChipText, active && { color: colors.white }]}>{c}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        <View style={styles.metaRow}>
          <Pill label={analysis.category || "Other"} />
          {analysis.language ? <Pill label={analysis.language} /> : null}
          {doc.pageCount ? <Pill label={`${doc.pageCount} page${doc.pageCount > 1 ? "s" : ""}`} /> : null}
          <Text style={styles.date}>{new Date(doc.createdAt).toLocaleDateString()}</Text>
        </View>

        {doc.pdfUri ? (
          <Pressable
            onPress={openPdf}
            style={({ pressed }) => [styles.pdfBtn, pressed && { opacity: 0.9 }]}
          >
            <FileDown color={colors.accent} size={18} />
            <Text style={styles.pdfBtnText}>Open / share PDF</Text>
          </Pressable>
        ) : null}

        {analysis.summary ? (
          <Card style={{ marginTop: spacing.md }}>
            <Text style={styles.sectionLabel}>Summary</Text>
            <Text style={styles.summary}>{analysis.summary}</Text>
          </Card>
        ) : null}

        {highlights.length > 0 && (
          <View style={{ marginTop: spacing.lg }}>
            <Text style={styles.heading}>Highlights</Text>
            <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
              {highlights.map((h) => (
                <HighlightRow key={h.id} h={h} />
              ))}
            </View>
          </View>
        )}

        {analysis.entities.length > 0 && (
          <View style={{ marginTop: spacing.lg }}>
            <Text style={styles.heading}>Entities</Text>
            <View style={styles.entityWrap}>
              {analysis.entities.map((e, i) => (
                <View key={`${e.name}-${i}`} style={styles.entity}>
                  <Text style={styles.entityName}>{e.name}</Text>
                  <Text style={styles.entityType}>{e.type}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {analysis.fullText ? (
          <Card style={{ marginTop: spacing.lg }}>
            <Pressable style={styles.textToggle} onPress={() => setShowText((s) => !s)}>
              <Text style={styles.sectionLabel}>Extracted text</Text>
              {showText ? (
                <ChevronUp color={colors.textMuted} size={18} />
              ) : (
                <ChevronDown color={colors.textMuted} size={18} />
              )}
            </Pressable>
            {showText && <Text style={styles.fullText}>{analysis.fullText}</Text>}
          </Card>
        ) : null}

        <View style={{ height: spacing.xxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function HighlightRow({ h }: { h: Highlight }) {
  const Icon = ICONS[h.type];
  const c = highlightColor[h.type];
  return (
    <Card style={[styles.highlight, { borderLeftColor: c, borderLeftWidth: 4 }]}>
      <View style={[styles.hIcon, { backgroundColor: c + "1A" }]}>
        <Icon color={c} size={18} />
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.hTop}>
          <Text style={[styles.hType, { color: c }]}>{highlightLabel[h.type]}</Text>
          {h.severity === "high" && <Text style={styles.hUrgent}>URGENT</Text>}
        </View>
        <Text style={styles.hText}>{h.text}</Text>
        {(h.date || h.amount) && (
          <View style={styles.hMetaRow}>
            {h.date ? <Text style={styles.hMeta}>📅 {h.date}</Text> : null}
            {h.amount ? <Text style={styles.hMeta}>💶 {h.amount}</Text> : null}
          </View>
        )}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  loading: { padding: spacing.xl, color: colors.textMuted },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  scroll: { padding: spacing.lg, paddingTop: spacing.sm },
  hero: {
    width: "100%",
    height: 220,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceAlt,
    marginBottom: spacing.lg,
  },
  titleRow: { marginBottom: spacing.sm },
  title: { fontSize: font.h1, fontWeight: "800", color: colors.text, lineHeight: 34 },
  titleInput: {
    fontSize: font.h1,
    fontWeight: "800",
    color: colors.text,
    lineHeight: 34,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    backgroundColor: colors.surface,
  },
  saveBtn: { backgroundColor: colors.accent, borderColor: colors.accent },
  catRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.md },
  catChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  catChipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  catChipText: { fontSize: font.small, color: colors.textMuted, fontWeight: "600" },
  metaRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" },
  date: { fontSize: font.small, color: colors.textFaint },
  pdfBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    alignSelf: "flex-start",
    marginTop: spacing.md,
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  pdfBtnText: { fontSize: font.small, fontWeight: "700", color: colors.accent },
  sectionLabel: {
    fontSize: font.tiny,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  summary: { fontSize: font.body, color: colors.text, lineHeight: 22 },
  heading: { fontSize: font.h3, fontWeight: "700", color: colors.text },
  highlight: { flexDirection: "row", gap: spacing.md, alignItems: "flex-start" },
  hIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  hTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  hType: { fontSize: font.tiny, fontWeight: "800", letterSpacing: 0.4 },
  hUrgent: {
    fontSize: 9,
    fontWeight: "800",
    color: colors.white,
    backgroundColor: colors.critical,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: "hidden",
  },
  hText: { fontSize: font.body, color: colors.text, marginTop: 3, lineHeight: 21 },
  hMetaRow: { flexDirection: "row", gap: spacing.md, marginTop: 6 },
  hMeta: { fontSize: font.small, color: colors.textMuted, fontWeight: "600" },
  entityWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  entity: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  entityName: { fontSize: font.small, fontWeight: "600", color: colors.text },
  entityType: { fontSize: font.tiny, color: colors.textFaint, textTransform: "capitalize" },
  textToggle: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  fullText: { fontSize: font.small, color: colors.textMuted, lineHeight: 20, marginTop: spacing.sm },
});
