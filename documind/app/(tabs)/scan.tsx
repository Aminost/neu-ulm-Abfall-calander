import React from "react";
import * as DocumentPicker from "expo-document-picker";
import { useRouter } from "expo-router";
import {
  Camera,
  Check,
  ChevronDown,
  ChevronUp,
  FileText,
  FileUp,
  ImagePlus,
  Info,
  Plus,
  ScanLine,
  Trash2,
} from "lucide-react-native";
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
import {
  analyzeImage,
  analyzeImages,
  analyzeText,
  uploadBlob,
  upsertDocument,
} from "../../src/api/client";
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
  const [review, setReview] = useState<Page[]>([]); // pages awaiting review before PDF

  function reset() {
    setStage("idle");
    setPreview(null);
    setReview([]);
  }

  function addPages(pages: Page[]) {
    if (pages.length) setReview((prev) => [...prev, ...pages]);
  }
  function removePage(i: number) {
    setReview((prev) => prev.filter((_, idx) => idx !== i));
  }
  function movePage(i: number, dir: -1 | 1) {
    setReview((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }
  function confirmReview() {
    const pages = review;
    setReview([]);
    runPipeline(pages);
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
    // Store on the backend (knowledge graph + retrieval + cross-device access).
    upsertDocument({ id, title: analysis.title, createdAt: record.createdAt, analysis }).catch(
      () => {},
    );
    // Back up the original scan so it can be restored on another device.
    if (storedPdf) uriToBase64(storedPdf).then((b) => uploadBlob(id, "pdf", b)).catch(() => {});
    if (storedImg) uriToBase64(storedImg).then((b) => uploadBlob(id, "image", b)).catch(() => {});
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
        reset();
        addPages(pages);
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
      addPages(pages);
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
        addPages([{ uri: file.uri, base64 }]);
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
          addPages(pages);
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
        ) : review.length > 0 ? (
          <ReviewPages
            pages={review}
            onRemove={removePage}
            onMove={movePage}
            onAddCamera={() => setCameraOpen(true)}
            onAddLibrary={onImportImage}
            onCancel={() => setReview([])}
            onConfirm={confirmReview}
          />
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

function ReviewPages({
  pages,
  onRemove,
  onMove,
  onAddCamera,
  onAddLibrary,
  onCancel,
  onConfirm,
}: {
  pages: Page[];
  onRemove: (i: number) => void;
  onMove: (i: number, dir: -1 | 1) => void;
  onAddCamera: () => void;
  onAddLibrary: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <>
      <Card style={{ gap: spacing.md }}>
        <Text style={styles.reviewTitle}>
          Review {pages.length} page{pages.length === 1 ? "" : "s"}
        </Text>
        <Text style={styles.reviewHint}>Reorder or remove pages before creating the PDF.</Text>
        {pages.map((p, i) => (
          <View key={`${p.uri}-${i}`} style={styles.pageRow}>
            <Image source={{ uri: p.uri }} style={styles.pageThumb} resizeMode="cover" />
            <Text style={styles.pageNum}>Page {i + 1}</Text>
            <View style={styles.pageActions}>
              <Pressable onPress={() => onMove(i, -1)} disabled={i === 0} hitSlop={6} style={styles.pageBtn}>
                <ChevronUp color={i === 0 ? colors.textFaint : colors.text} size={18} />
              </Pressable>
              <Pressable
                onPress={() => onMove(i, 1)}
                disabled={i === pages.length - 1}
                hitSlop={6}
                style={styles.pageBtn}
              >
                <ChevronDown color={i === pages.length - 1 ? colors.textFaint : colors.text} size={18} />
              </Pressable>
              <Pressable onPress={() => onRemove(i)} hitSlop={6} style={styles.pageBtn}>
                <Trash2 color={colors.critical} size={17} />
              </Pressable>
            </View>
          </View>
        ))}
        <View style={styles.addRow}>
          <Pressable onPress={onAddCamera} style={styles.addChip}>
            <Camera color={colors.accent} size={16} />
            <Text style={styles.addChipText}>Add via camera</Text>
          </Pressable>
          <Pressable onPress={onAddLibrary} style={styles.addChip}>
            <Plus color={colors.accent} size={16} />
            <Text style={styles.addChipText}>Add from library</Text>
          </Pressable>
        </View>
      </Card>

      <Pressable onPress={onConfirm} style={({ pressed }) => [styles.confirmBtn, pressed && { opacity: 0.9 }]}>
        <Check color={colors.white} size={20} />
        <Text style={styles.confirmText}>Create PDF & analyze</Text>
      </Pressable>
      <Pressable onPress={onCancel} style={styles.cancelBtn}>
        <Text style={styles.cancelText}>Cancel</Text>
      </Pressable>
    </>
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
  reviewTitle: { fontSize: font.h3, fontWeight: "700", color: colors.text },
  reviewHint: { fontSize: font.small, color: colors.textMuted, marginTop: -6 },
  pageRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
  },
  pageThumb: { width: 46, height: 60, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt },
  pageNum: { flex: 1, fontSize: font.body, color: colors.text, fontWeight: "600" },
  pageActions: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  pageBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: colors.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  addRow: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap", marginTop: spacing.xs },
  addChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  addChipText: { fontSize: font.small, color: colors.accent, fontWeight: "600" },
  confirmBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    marginTop: spacing.md,
  },
  confirmText: { color: colors.white, fontWeight: "700", fontSize: font.body },
  cancelBtn: { alignItems: "center", paddingVertical: spacing.md },
  cancelText: { color: colors.textMuted, fontSize: font.body, fontWeight: "600" },
});
