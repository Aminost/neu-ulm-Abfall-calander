import React from "react";
import { useRouter } from "expo-router";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  MessageSquareText,
  ScanLine,
  Server,
  Sparkles,
  XCircle,
} from "lucide-react-native";
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Card } from "../src/components/ui";
import { checkHealth, upsertDocument } from "../src/api/client";
import { scheduleDeadlineReminders } from "../src/lib/notifications";
import { sampleDocuments } from "../src/lib/sampleData";
import { getSettings, saveDocument, saveSettings } from "../src/lib/storage";
import { colors, font, radius, spacing } from "../src/lib/theme";

type Health = { state: "idle" | "checking" | "ok" | "fail"; detail?: string };

export default function Onboarding() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [apiUrl, setApiUrl] = useState("");
  const [health, setHealth] = useState<Health>({ state: "idle" });
  const [seeding, setSeeding] = useState(false);

  useEffect(() => {
    getSettings().then((s) => setApiUrl(s.apiUrl));
  }, []);

  async function finish(afterSamples: boolean) {
    await saveSettings({ apiUrl: apiUrl.trim(), onboarded: true });
    if (afterSamples) {
      setSeeding(true);
      try {
        for (const doc of sampleDocuments()) {
          await saveDocument(doc);
          scheduleDeadlineReminders(doc).catch(() => {});
          upsertDocument({
            id: doc.id,
            title: doc.analysis.title,
            createdAt: doc.createdAt,
            analysis: doc.analysis,
          }).catch(() => {});
        }
      } finally {
        setSeeding(false);
      }
    }
    router.replace("/(tabs)");
  }

  async function testConnection() {
    setHealth({ state: "checking" });
    try {
      await saveSettings({ apiUrl: apiUrl.trim() });
      const res = await checkHealth();
      setHealth({ state: "ok", detail: res.model });
    } catch (e) {
      setHealth({ state: "fail", detail: e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.logo}>
          <Sparkles color={colors.accent} size={30} />
        </View>

        {step === 0 && (
          <>
            <Text style={styles.title}>Welcome to DocuMind</Text>
            <Text style={styles.sub}>
              Your documents, digitized and understood — a smart companion in your pocket.
            </Text>
            <View style={{ gap: spacing.md, marginTop: spacing.xl }}>
              <Feature icon={<ScanLine color={colors.accent} size={20} />} title="Scan & save as PDF" text="Capture any document; it's read, sorted, and saved." />
              <Feature icon={<AlertTriangle color={colors.deadline} size={20} />} title="Deadlines & payments" text="Important dates and amounts are detected and highlighted." />
              <Feature icon={<CalendarClock color={colors.payment} size={20} />} title="Stay ready" text="An agenda and reminders keep you ahead of bureaucracy." />
              <Feature icon={<MessageSquareText color={colors.action} size={20} />} title="Ask anything" text="A chatbot answers from your documents, with sources." />
            </View>
            <View style={{ marginTop: spacing.xl }}>
              <Button label="Get started" onPress={() => setStep(1)} />
            </View>
          </>
        )}

        {step === 1 && (
          <>
            <Text style={styles.title}>Connect your backend</Text>
            <Text style={styles.sub}>
              DocuMind talks to a small server (the <Text style={styles.code}>server/</Text> folder)
              that holds your AI key. Enter its address, or skip and set it later in Settings.
            </Text>
            <Card style={{ gap: spacing.md, marginTop: spacing.xl }}>
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
              <Button
                label="Test connection"
                onPress={testConnection}
                variant="secondary"
                loading={health.state === "checking"}
              />
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
            <View style={{ marginTop: spacing.xl, gap: spacing.sm }}>
              <Button label="Continue" onPress={() => setStep(2)} />
              <Button label="Skip for now" onPress={() => setStep(2)} variant="ghost" />
            </View>
          </>
        )}

        {step === 2 && (
          <>
            <Text style={styles.title}>You're all set</Text>
            <Text style={styles.sub}>
              Start by loading a few example documents to explore, or jump straight to scanning your
              own.
            </Text>
            <View style={{ marginTop: spacing.xl, gap: spacing.md }}>
              <Button
                label="Load sample documents"
                onPress={() => finish(true)}
                variant="secondary"
                loading={seeding}
              />
              <Button label="Start scanning" onPress={() => finish(false)} />
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Feature({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <View style={styles.feature}>
      <View style={styles.featureIcon}>{icon}</View>
      <View style={{ flex: 1 }}>
        <Text style={styles.featureTitle}>{title}</Text>
        <Text style={styles.featureText}>{text}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.xl, paddingTop: spacing.xxl },
  logo: {
    width: 60,
    height: 60,
    borderRadius: 18,
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
  },
  title: { fontSize: font.h1, fontWeight: "800", color: colors.text },
  sub: { fontSize: font.body, color: colors.textMuted, lineHeight: 22, marginTop: spacing.sm },
  code: { fontFamily: "monospace", color: colors.text },
  feature: { flexDirection: "row", gap: spacing.md, alignItems: "center" },
  featureIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  featureTitle: { fontSize: font.body, fontWeight: "700", color: colors.text },
  featureText: { fontSize: font.small, color: colors.textMuted, marginTop: 1 },
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
  status: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
  },
  statusText: { flex: 1, fontSize: font.small, fontWeight: "600" },
});
