import React from "react";
import * as DocumentPicker from "expo-document-picker";
import { useRouter } from "expo-router";
import { Camera, FileText, FileUp, ImagePlus, Info, ScanLine } from "lucide-react-native";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CameraModal } from "../../src/components/CameraModal";
import { Card, ScreenTitle } from "../../src/components/ui";
import { analyzeImage, analyzeImages, analyzeText, indexDocument } from "../../src/api/client";
import { scheduleDeadlineReminders } from "../../src/lib/notifications";
import { newId, persistFile, saveDocument } from "../../src/lib/storage";
import {
  imagesToPdf,
  nativeScannerAvailable,
  pickImagesFromLibrary,
  scanWithNativeScanner,
  uriToBase64,
  uriToText,
  type Page,
} from "../../src/lib/scanner";
import { colors, font, radius, spacing } from "../../src/lib/theme";
import type { DocAnalysis } from "../../src/lib/types";

type Stage = "idle" | "scanning" | "building" | "analyzing";

const STAGE_TEXT: Record<Exclude<Stage, "idle">, string> = {
  scanning: "Detecting document edges…",
  building: "Building PDF…",
  analyzing: "Reading, sorting & flagging…",
};

export default function ScanScreen() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("idle");
  const [preview, setPreview] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);

  function reset() {
    setStage("idle");
    setPreview(null);
  }

  function fail(e: unknown) {
    reset();
    Alert.alert("Couldn't process document", e instanceof Error ? e.message : String(e));
  }

  async function finish(
    analysis: DocAnalysis,
    thumbUri?: string,
    pdfUri?: string,
    pageCount?: number,
  ) {
    const id = newId();
    const storedImg = thumbUri ? await persistFile(thumbUri, id, "jpg") : undefined;
    const storedPdf = pdfUri ? await persistFile(pdfUri, id, "pdf") : undefined;
    const record = {
      id,
      createdAt: Date.now(),
      imageUri: storedImg,
      pdfUri: storedPdf,
      pageCount,
      status: "ready" as const,
      analysis,
    };
    await saveDocument(record);
    indexDocument(id, analysis.title, analysis.fullText).catch(() => {});
    // Set on-device reminders for any detected deadlines.
    scheduleDeadlineReminders(record).catch(() => {});
    reset();
    router.push(`/document/${id}`);
  }

  // Shared pipeline for captured / imported page images.
  async function runPipeline(pages: Page[]) {
    try {
      if (pages.length === 0) {
        reset();
        return;
      }
      setPreview(pages[0].uri);

      setStage("building");
      let pdfUri: string | undefined;
      try {
        pdfUri = await imagesToPdf(pages.map((p) => p.base64));
      } catch {
        // PDF is a bonus (unavailable on web) — carry on.
      }

      setStage("analyzing");
      const analysis = await analyzeImages(pages.map((p) => p.base64));
      await finish(analysis, pages[0].uri, pdfUri, pages.length);
    } catch (e) {
      fail(e);
    }
  }

  async function onScanPress() {
    // Prefer the auto-detecting native scanner when a dev build provides it;
    // otherwise open the live camera (works in Expo Go and the browser).
    if (nativeScannerAvailable()) {
      try {
        setStage("scanning");
        const uris = await scanWithNativeScanner();
        if (!uris) {
          reset();
          return;
        }
        const pages = await Promise.all(
          uris.map(async (uri) => ({ uri, base64: await uriToBase64(uri) })),
        );
        await runPipeline(pages);
      } catch (e) {
        fail(e);
      }
    } else {
      setCameraOpen(true);
    }
  }

  async function onImportImage() {
    try {
      const pages = await pickImagesFromLibrary();
      if (!pages) return;
      await runPipeline(pages);
    } catch (e) {
      fail(e);
    }
  }

  async function onImportFile() {
    const res = await DocumentPicker.getDocumentAsync({
      type: ["application/pdf", "text/*", "image/*"],
      copyToCacheDirectory: true,
    });
    if (res.canceled) return;
    const file = res.assets[0];
    const mime = file.mimeType ?? "";
    try {
      if (mime.startsWith("image/")) {
        const base64 = await uriToBase64(file.uri);
        await runPipeline([{ uri: file.uri, base64 }]);
      } else if (mime === "application/pdf") {
        setStage("analyzing");
        const data = await uriToBase64(file.uri);
        const analysis = await analyzeImage(data, "application/pdf");
        await finish(analysis, undefined, file.uri, undefined);
      } else if (mime.startsWith("text/")) {
        setStage("analyzing");
        const text = await uriToText(file.uri);
        const analysis = await analyzeText(text);
        await finish(analysis);
      } else {
        Alert.alert("Unsupported file", "Pick a PDF, image, or text file.");
      }
    } catch (e) {
      fail(e);
    }
  }

  const busy = stage !== "idle";

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <CameraModal
        visible={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onDone={(pages) => {
          setCameraOpen(false);
          runPipeline(pages);
        }}
      />

      <ScrollView contentContainerStyle={styles.scroll}>
        <ScreenTitle
          title="Scan"
          subtitle="Point at any document — DocuMind reads it, flags what matters, and (on device) saves a PDF."
        />

        {busy ? (
          <Card style={styles.processing}>
            {preview ? (
              <Image source={{ uri: preview }} style={styles.previewImg} resizeMode="cover" />
            ) : (
              <View style={[styles.previewImg, styles.previewPlaceholder]}>
                <FileText color={colors.textFaint} size={36} />
              </View>
            )}
            <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.lg }} />
            <Text style={styles.processingText}>
              {STAGE_TEXT[stage as Exclude<Stage, "idle">]}
            </Text>
          </Card>
        ) : (
          <>
            <Pressable onPress={onScanPress} style={({ pressed }) => pressed && { opacity: 0.9 }}>
              <Card style={styles.primary}>
                <View style={styles.primaryIcon}>
                  <ScanLine color={colors.white} size={28} />
                </View>
                <Text style={styles.primaryTitle}>Scan document</Text>
                <Text style={styles.primarySub}>
                  {nativeScannerAvailable()
                    ? "Auto edge-detection · multi-page · PDF"
                    : "Live camera · multi-page capture"}
                </Text>
              </Card>
            </Pressable>

            <Action
              icon={<ImagePlus color={colors.accent} size={24} />}
              title="Import image"
              subtitle="Pick photos from your library (multi-select)"
              onPress={onImportImage}
            />
            <Action
              icon={<FileUp color={colors.accent} size={24} />}
              title="Import file"
              subtitle="PDF or text document"
              onPress={onImportFile}
            />

            <Card style={styles.note}>
              {nativeScannerAvailable() ? (
                <Camera color={colors.accent} size={18} />
              ) : (
                <Info color={colors.accent} size={18} />
              )}
              <Text style={styles.noteText}>
                {nativeScannerAvailable()
                  ? "The scanner detects page edges automatically — add several pages to build a multi-page PDF."
                  : "Running in Expo Go / the browser: “Scan document” opens the live camera. Automatic edge-detection and PDF export need a development build (see README → Document scanner)."}
              </Text>
            </Card>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Action({
  icon,
  title,
  subtitle,
  onPress,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => pressed && { opacity: 0.9 }}>
      <Card style={styles.action}>
        <View style={styles.actionIcon}>{icon}</View>
        <View style={{ flex: 1 }}>
          <Text style={styles.actionTitle}>{title}</Text>
          <Text style={styles.actionSub}>{subtitle}</Text>
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, gap: spacing.md },
  primary: { alignItems: "center", gap: 6, backgroundColor: colors.accent, paddingVertical: spacing.xl },
  primaryIcon: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xs,
  },
  primaryTitle: { fontSize: font.h2, fontWeight: "800", color: colors.white },
  primarySub: { fontSize: font.small, color: "rgba(255,255,255,0.85)" },
  action: { flexDirection: "row", alignItems: "center", gap: spacing.lg },
  actionIcon: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  actionTitle: { fontSize: font.h3, fontWeight: "700", color: colors.text },
  actionSub: { fontSize: font.small, color: colors.textMuted, marginTop: 2 },
  note: { flexDirection: "row", gap: spacing.md, backgroundColor: colors.accentSoft, marginTop: spacing.sm },
  noteText: { flex: 1, fontSize: font.small, color: colors.textMuted, lineHeight: 19 },
  processing: { alignItems: "center", paddingVertical: spacing.xl },
  previewImg: {
    width: 160,
    height: 200,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
  },
  previewPlaceholder: { alignItems: "center", justifyContent: "center" },
  processingText: {
    fontSize: font.body,
    color: colors.textMuted,
    marginTop: spacing.sm,
    textAlign: "center",
  },
});
