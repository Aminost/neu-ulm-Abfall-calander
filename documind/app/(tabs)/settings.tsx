import { Bell, CheckCircle2, CloudDownload, Server, Sparkles, XCircle } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Alert, Platform, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Card, ScreenTitle } from "../../src/components/ui";
import {
  checkHealth,
  fetchBlob,
  fetchServerDocuments,
  upsertDocument,
} from "../../src/api/client";
import {
  getDocument,
  getSettings,
  mergeRestored,
  saveDocument,
  saveSettings,
  writeBase64File,
} from "../../src/lib/storage";
import { exportLibrary, importLibrary } from "../../src/lib/backup";
import { rescheduleAll, scheduleDeadlineReminders } from "../../src/lib/notifications";
import { sampleDocuments } from "../../src/lib/sampleData";
import { listDocuments } from "../../src/lib/storage";
import { colors, font, radius, spacing } from "../../src/lib/theme";

type Health = { state: "idle" | "checking" | "ok" | "fail"; detail?: string };

export default function SettingsScreen() {
  const [apiUrl, setApiUrl] = useState("");
  const [saved, setSaved] = useState(false);
  const [health, setHealth] = useState<Health>({ state: "idle" });
  const [restoring, setRestoring] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [reminderDays, setReminderDays] = useState(2);
  const [remindPay, setRemindPay] = useState(true);
  const [rescheduling, setRescheduling] = useState(false);

  async function updateReminderDays(n: number) {
    setReminderDays(n);
    await saveSettings({ apiUrl: apiUrl.trim(), reminderDaysBefore: n, remindPayments: remindPay });
  }
  async function updateRemindPay(v: boolean) {
    setRemindPay(v);
    await saveSettings({ apiUrl: apiUrl.trim(), reminderDaysBefore: reminderDays, remindPayments: v });
  }
  const [busyBackup, setBusyBackup] = useState<"export" | "import" | null>(null);

  async function doExport() {
    setBusyBackup("export");
    try {
      const r = await exportLibrary();
      if (r === "empty") Alert.alert("Nothing to export", "Your library is empty.");
    } catch (e) {
      Alert.alert("Export failed", e instanceof Error ? e.message : String(e));
    } finally {
      setBusyBackup(null);
    }
  }
  async function doImport() {
    setBusyBackup("import");
    try {
      const added = await importLibrary();
      Alert.alert(
        "Import complete",
        added > 0 ? `Added ${added} document${added === 1 ? "" : "s"}.` : "No new documents to add.",
      );
    } catch (e) {
      Alert.alert("Import failed", e instanceof Error ? e.message : String(e));
    } finally {
      setBusyBackup(null);
    }
  }

  async function reschedule() {
    setRescheduling(true);
    try {
      const count = await rescheduleAll(await listDocuments());
      Alert.alert("Reminders updated", `Scheduled ${count} reminder${count === 1 ? "" : "s"}.`);
    } catch (e) {
      Alert.alert("Couldn't reschedule", e instanceof Error ? e.message : String(e));
    } finally {
      setRescheduling(false);
    }
  }

  async function loadSamples() {
    setSeeding(true);
    try {
      const samples = sampleDocuments();
      for (const doc of samples) {
        await saveDocument(doc);
        scheduleDeadlineReminders(doc).catch(() => {});
        // Push to the backend too, so chat/graph work on the samples if it's running.
        upsertDocument({
          id: doc.id,
          title: doc.analysis.title,
          createdAt: doc.createdAt,
          analysis: doc.analysis,
        }).catch(() => {});
      }
      Alert.alert(
        "Sample documents loaded",
        `Added ${samples.length} example documents. Open the Library, Graph and Ask tabs to explore.`,
      );
    } catch (e) {
      Alert.alert("Couldn't load samples", e instanceof Error ? e.message : String(e));
    } finally {
      setSeeding(false);
    }
  }

  async function restore() {
    setRestoring(true);
    try {
      const remote = await fetchServerDocuments();
      const addedIds = await mergeRestored(remote);

      // Pull down the original scans (PDF + page image) for restored docs.
      if (Platform.OS !== "web") {
        for (const docId of addedIds) {
          try {
            const pdf = await fetchBlob(docId, "pdf");
            const img = await fetchBlob(docId, "image");
            const pdfUri = pdf ? await writeBase64File(pdf, docId, "pdf") : "";
            const imageUri = img ? await writeBase64File(img, docId, "jpg") : "";
            if (pdfUri || imageUri) {
              const d = await getDocument(docId);
              if (d) {
                await saveDocument({
                  ...d,
                  pdfUri: pdfUri || d.pdfUri,
                  imageUri: imageUri || d.imageUri,
                });
              }
            }
          } catch {
            /* skip a blob that fails; text/analysis already restored */
          }
        }
      }

      Alert.alert(
        "Restore complete",
        addedIds.length > 0
          ? `Added ${addedIds.length} document${addedIds.length === 1 ? "" : "s"} from the backend.`
          : "Your library is already up to date.",
      );
    } catch (e) {
      Alert.alert("Restore failed", e instanceof Error ? e.message : String(e));
    } finally {
      setRestoring(false);
    }
  }

  useEffect(() => {
    getSettings().then((s) => {
      setApiUrl(s.apiUrl);
      setReminderDays(s.reminderDaysBefore ?? 2);
      setRemindPay(s.remindPayments ?? true);
    });
  }, []);

  async function save() {
    await saveSettings({ apiUrl: apiUrl.trim() });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  async function test() {
    setHealth({ state: "checking" });
    try {
      await saveSettings({ apiUrl: apiUrl.trim() });
      const res = await checkHealth();
      setHealth({ state: "ok", detail: res.model ? `Model: ${res.model}` : undefined });
    } catch (e) {
      setHealth({ state: "fail", detail: e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <ScreenTitle title="Settings" subtitle="Connect the app to your AI backend." />

        <Card style={{ gap: spacing.md }}>
          <View style={styles.labelRow}>
            <Server color={colors.accent} size={18} />
            <Text style={styles.label}>Backend URL</Text>
          </View>
          <TextInput
            style={styles.input}
            value={apiUrl}
            onChangeText={setApiUrl}
            placeholder="http://192.168.1.20:3001"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <Text style={styles.hint}>
            This is the address of the DocuMind server (the <Text style={styles.code}>server/</Text>{" "}
            folder). On a physical phone, use your computer's LAN IP, not localhost.
          </Text>

          <View style={styles.btnRow}>
            <View style={{ flex: 1 }}>
              <Button label={saved ? "Saved ✓" : "Save"} onPress={save} variant="primary" />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                label="Test connection"
                onPress={test}
                variant="secondary"
                loading={health.state === "checking"}
              />
            </View>
          </View>

          {health.state === "ok" && (
            <View style={[styles.status, { backgroundColor: colors.accentSoft }]}>
              <CheckCircle2 color={colors.ok} size={18} />
              <Text style={[styles.statusText, { color: colors.ok }]}>
                Connected{health.detail ? ` · ${health.detail}` : ""}
              </Text>
            </View>
          )}
          {health.state === "fail" && (
            <View style={[styles.status, { backgroundColor: "#FBE9E7" }]}>
              <XCircle color={colors.critical} size={18} />
              <Text style={[styles.statusText, { color: colors.critical }]}>{health.detail}</Text>
            </View>
          )}
        </Card>

        <Card style={{ marginTop: spacing.md, gap: spacing.md }}>
          <View style={styles.labelRow}>
            <Bell color={colors.accent} size={18} />
            <Text style={styles.label}>Reminders</Text>
          </View>
          <Text style={styles.hint}>Remind me this many days before a deadline:</Text>
          <View style={styles.daysRow}>
            {[0, 1, 2, 3, 7].map((n) => {
              const active = n === reminderDays;
              return (
                <Text
                  key={n}
                  onPress={() => updateReminderDays(n)}
                  style={[styles.dayChip, active && styles.dayChipActive]}
                >
                  {n === 0 ? "Same day" : `${n}d`}
                </Text>
              );
            })}
          </View>
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>Also remind me about payments</Text>
            <Switch
              value={remindPay}
              onValueChange={updateRemindPay}
              trackColor={{ true: colors.accent, false: colors.border }}
            />
          </View>
          <Button
            label="Reschedule all reminders"
            onPress={reschedule}
            variant="secondary"
            loading={rescheduling}
          />
          {Platform.OS === "web" && (
            <Text style={styles.hint}>Reminders run on the phone app, not in the browser.</Text>
          )}
        </Card>

        <Card style={{ marginTop: spacing.md, gap: spacing.md }}>
          <View style={styles.labelRow}>
            <CloudDownload color={colors.accent} size={18} />
            <Text style={styles.label}>Sync</Text>
          </View>
          <Text style={styles.hint}>
            Documents are stored on your backend as they're scanned. On a new device, restore your
            library (titles, analysis, deadlines and text) from there.
          </Text>
          <Button
            label="Restore from backend"
            onPress={restore}
            variant="secondary"
            loading={restoring}
          />
          <Text style={styles.hint}>Or keep a portable backup file you control:</Text>
          <View style={styles.backupRow}>
            <View style={{ flex: 1 }}>
              <Button
                label="Export"
                onPress={doExport}
                variant="secondary"
                loading={busyBackup === "export"}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                label="Import"
                onPress={doImport}
                variant="secondary"
                loading={busyBackup === "import"}
              />
            </View>
          </View>
        </Card>

        <Card style={{ marginTop: spacing.md, gap: spacing.md }}>
          <View style={styles.labelRow}>
            <Sparkles color={colors.accent} size={18} />
            <Text style={styles.label}>Try it out</Text>
          </View>
          <Text style={styles.hint}>
            Load a few realistic example documents (an invoice, an insurance letter, and a fine)
            to explore the Library, highlights, knowledge graph and deadline alerts without
            scanning anything.
          </Text>
          <Button
            label="Load sample documents"
            onPress={loadSamples}
            variant="secondary"
            loading={seeding}
          />
        </Card>

        <Card style={{ marginTop: spacing.md }}>
          <Text style={styles.aboutTitle}>About</Text>
          <Text style={styles.aboutText}>
            DocuMind digitizes documents with a vision model, classifies them by topic, extracts
            deadlines, payments and critical issues, and lets you ask questions across everything
            with a retrieval-augmented chatbot. Documents are stored locally on your device; only
            the text needed to answer a question is sent to your backend.
          </Text>
        </Card>
        <View style={{ height: spacing.xxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg },
  labelRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  label: { fontSize: font.h3, fontWeight: "700", color: colors.text },
  input: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: font.body,
    color: colors.text,
  },
  hint: { fontSize: font.small, color: colors.textMuted, lineHeight: 19 },
  code: { fontFamily: "monospace", color: colors.text },
  btnRow: { flexDirection: "row", gap: spacing.md },
  status: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
  },
  statusText: { flex: 1, fontSize: font.small, fontWeight: "600" },
  daysRow: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  dayChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.textMuted,
    fontSize: font.small,
    fontWeight: "600",
    overflow: "hidden",
  },
  dayChipActive: { backgroundColor: colors.accent, borderColor: colors.accent, color: colors.white },
  backupRow: { flexDirection: "row", gap: spacing.md },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  switchLabel: { fontSize: font.body, color: colors.text, flex: 1 },
  aboutTitle: { fontSize: font.h3, fontWeight: "700", color: colors.text, marginBottom: spacing.sm },
  aboutText: { fontSize: font.body, color: colors.textMuted, lineHeight: 21 },
});
