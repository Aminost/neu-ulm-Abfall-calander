import React from "react";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { Camera, FileUp, ImagePlus, Sparkles } from "lucide-react-native";
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
import { analyzeImage, analyzeText, indexDocument } from "../../src/api/client";
import { newId, persistImage, saveDocument } from "../../src/lib/storage";
import { colors, font, radius, spacing } from "../../src/lib/theme";
import type { DocAnalysis } from "../../src/lib/types";

type Stage = "idle" | "reading" | "analyzing";

const STAGE_TEXT: Record<Exclude<Stage, "idle">, string> = {
  reading: "Reading the document…",
  analyzing: "Understanding content, sorting & flagging…",
};

export default function ScanScreen() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("idle");
  const [preview, setPreview] = useState<string | null>(null);

  async function finish(analysis: DocAnalysis, imageUri?: string) {
    const id = newId();
    const storedUri = imageUri ? await persistImage(imageUri, id) : undefined;
    await saveDocument({
      id,
      createdAt: Date.now(),
      imageUri: storedUri,
      status: "ready",
      analysis,
    });
    // Index for RAG chat — non-fatal if it fails.
    indexDocument(id, analysis.title, analysis.fullText).catch(() => {});
    setStage("idle");
    setPreview(null);
    router.push(`/document/${id}`);
  }

  function fail(e: unknown) {
    setStage("idle");
    setPreview(null);
    Alert.alert("Couldn't process document", e instanceof Error ? e.message : String(e));
  }

  async function handleImage(uri: string, base64?: string, mime = "image/jpeg") {
    try {
      setPreview(uri);
      setStage("analyzing");
      const data =
        base64 ?? (await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 }));
      const analysis = await analyzeImage(data, mime);
      await finish(analysis, uri);
    } catch (e) {
      fail(e);
    }
  }

  async function takePhoto() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Camera permission needed", "Enable camera access to scan documents.");
      return;
    }
    const res = await ImagePicker.launchCameraAsync({
      base64: true,
      quality: 0.7,
      allowsEditing: true,
    });
    if (res.canceled) return;
    const a = res.assets[0];
    await handleImage(a.uri, a.base64 ?? undefined, a.mimeType ?? "image/jpeg");
  }

  async function importImage() {
    const res = await ImagePicker.launchImageLibraryAsync({
      base64: true,
      quality: 0.7,
      mediaTypes: ["images"],
    });
    if (res.canceled) return;
    const a = res.assets[0];
    await handleImage(a.uri, a.base64 ?? undefined, a.mimeType ?? "image/jpeg");
  }

  async function importFile() {
    const res = await DocumentPicker.getDocumentAsync({
      type: ["image/*", "text/*", "application/pdf"],
      copyToCacheDirectory: true,
    });
    if (res.canceled) return;
    const file = res.assets[0];
    const mime = file.mimeType ?? "";
    try {
      if (mime.startsWith("image/")) {
        await handleImage(file.uri, undefined, mime);
      } else if (mime.startsWith("text/")) {
        setStage("reading");
        const text = await FileSystem.readAsStringAsync(file.uri);
        setStage("analyzing");
        const analysis = await analyzeText(text);
        await finish(analysis);
      } else if (mime === "application/pdf") {
        setStage("reading");
        const data = await FileSystem.readAsStringAsync(file.uri, { encoding: FileSystem.EncodingType.Base64 });
        setStage("analyzing");
        const analysis = await analyzeImage(data, "application/pdf");
        await finish(analysis);
      } else {
        Alert.alert("Unsupported file", "Pick an image, PDF, or text file.");
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
          subtitle="Capture or import a document. One AI pass reads it, classifies it, and flags what matters."
        />

        {busy ? (
          <Card style={styles.processing}>
            {preview ? (
              <Image source={{ uri: preview }} style={styles.previewImg} resizeMode="cover" />
            ) : (
              <View style={[styles.previewImg, styles.previewPlaceholder]}>
                <FileUp color={colors.textFaint} size={36} />
              </View>
            )}
            <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.lg }} />
            <Text style={styles.processingText}>{STAGE_TEXT[stage as Exclude<Stage, "idle">]}</Text>
          </Card>
        ) : (
          <>
            <Action
              icon={<Camera color={colors.accent} size={24} />}
              title="Scan with camera"
              subtitle="Photograph a paper document"
              onPress={takePhoto}
            />
            <Action
              icon={<ImagePlus color={colors.accent} size={24} />}
              title="Import image"
              subtitle="Choose a photo from your library"
              onPress={importImage}
            />
            <Action
              icon={<FileUp color={colors.accent} size={24} />}
              title="Import file"
              subtitle="PDF or text document"
              onPress={importFile}
            />

            <Card style={styles.note}>
              <Sparkles color={colors.accent} size={18} />
              <Text style={styles.noteText}>
                DocuMind uses a vision model to read each page directly — no separate OCR step.
                It extracts the text, picks a topic, and highlights deadlines, payments and
                critical issues automatically.
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
