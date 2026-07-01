import React from "react";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
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
import { Card, ScreenTitle } from "../../src/components/ui";
import { analyzeImage, analyzeImages, analyzeText, indexDocument } from "../../src/api/client";
import { newId, persistFile, saveDocument } from "../../src/lib/storage";
import {
  imagesToPdf,
  nativeScannerAvailable,
  pickFromLibrary,
  readBase64,
  scanDocument,
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

  async function finish(
    analysis: DocAnalysis,
    thumbUri?: string,
    pdfUri?: string,
    pageCount?: number,
  ) {
    const id = newId();
    const storedImg = thumbUri ? await persistFile(thumbUri, id, "jpg") : undefined;
    const storedPdf = pdfUri ? await persistFile(pdfUri, id, "pdf") : undefined;
    await saveDocument({
      id,
      createdAt: Date.now(),
      imageUri: storedImg,
      pdfUri: storedPdf,
      pageCount,
      status: "ready",
      analysis,
    });
    indexDocument(id, analysis.title, analysis.fullText).catch(() => {});
    reset();
    router.push(`/document/${id}`);
  }

  function reset() {
    setStage("idle");
    setPreview(null);
  }

  function fail(e: unknown) {
    reset();
    Alert.alert("Couldn't process document", e instanceof Error ? e.message : String(e));
  }

  // Shared pipeline for scanned / imported page images: PDF → analyze → save.
  async function processImages(imageUris: string[]) {
    try {
      if (imageUris.length === 0) {
        reset();
        return;
      }
      setPreview(imageUris[0]);

      setStage("building");
      let pdfUri: string | undefined;
      try {
        pdfUri = await imagesToPdf(imageUris);
      } catch {
        // PDF is a bonus; continue even if generation isn't available (e.g. web).
      }

      setStage("analyzing");
      const pages = await Promise.all(imageUris.map(readBase64));
      const analysis = await analyzeImages(pages);
      await finish(analysis, imageUris[0], pdfUri, imageUris.length);
    } catch (e) {
      fail(e);
    }
  }

  async function onScan() {
    try {
      setStage("scanning");
      const result = await scanDocument();
      if (!result) {
        reset();
        return;
      }
      await processImages(result.imageUris);
    } catch (e) {
      fail(e);
    }
  }

  async function onImportImage() {
    try {
      const result = await pickFromLibrary();
      if (!result) return;
      await processImages(result.imageUris);
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
        await processImages([file.uri]);
      } else if (mime === "application/pdf") {
        setStage("analyzing");
        setPreview(null);
        const data = await FileSystem.readAsStringAsync(file.uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        const analysis = await analyzeImage(data, "application/pdf");
        await finish(analysis, undefined, file.uri, undefined);
      } else if (mime.startsWith("text/")) {
        setStage("analyzing");
        const text = await FileSystem.readAsStringAsync(file.uri);
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
      <ScrollView contentContainerStyle={styles.scroll}>
        <ScreenTitle
          title="Scan"
          subtitle="Point at any document — DocuMind auto-detects the page, saves a PDF, then reads and flags it."
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
            <Pressable onPress={onScan} style={({ pressed }) => pressed && { opacity: 0.9 }}>
              <Card style={styles.primary}>
                <View style={styles.primaryIcon}>
                  <ScanLine color={colors.white} size={28} />
                </View>
                <Text style={styles.primaryTitle}>Scan document</Text>
                <Text style={styles.primarySub}>
                  Auto edge-detection · multi-page · saved as PDF
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

            {!nativeScannerAvailable() && (
              <Card style={styles.note}>
                <Info color={colors.accent} size={18} />
                <Text style={styles.noteText}>
                  The auto-detecting scanner needs a development build (it's a native module and
                  isn't in Expo Go or the web preview). Until then, “Scan document” falls back to
                  your camera. See the README → “Document scanner” to enable it.
                </Text>
              </Card>
            )}
            {nativeScannerAvailable() && (
              <Card style={styles.note}>
                <Camera color={colors.accent} size={18} />
                <Text style={styles.noteText}>
                  Line the document up in the scanner — edges are detected automatically. Add more
                  pages before finishing to build a multi-page PDF.
                </Text>
              </Card>
            )}
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
