import { CheckCircle2, CloudDownload, Server, XCircle } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Card, ScreenTitle } from "../../src/components/ui";
import { checkHealth, fetchServerDocuments } from "../../src/api/client";
import { getSettings, mergeRestored, saveSettings } from "../../src/lib/storage";
import { colors, font, radius, spacing } from "../../src/lib/theme";

type Health = { state: "idle" | "checking" | "ok" | "fail"; detail?: string };

export default function SettingsScreen() {
  const [apiUrl, setApiUrl] = useState("");
  const [saved, setSaved] = useState(false);
  const [health, setHealth] = useState<Health>({ state: "idle" });
  const [restoring, setRestoring] = useState(false);

  async function restore() {
    setRestoring(true);
    try {
      const remote = await fetchServerDocuments();
      const added = await mergeRestored(remote);
      Alert.alert(
        "Restore complete",
        added > 0
          ? `Added ${added} document${added === 1 ? "" : "s"} from the backend.`
          : "Your library is already up to date.",
      );
    } catch (e) {
      Alert.alert("Restore failed", e instanceof Error ? e.message : String(e));
    } finally {
      setRestoring(false);
    }
  }

  useEffect(() => {
    getSettings().then((s) => setApiUrl(s.apiUrl));
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
  aboutTitle: { fontSize: font.h3, fontWeight: "700", color: colors.text, marginBottom: spacing.sm },
  aboutText: { fontSize: font.body, color: colors.textMuted, lineHeight: 21 },
});
