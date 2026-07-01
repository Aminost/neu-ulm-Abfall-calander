// A live-camera capture sheet built on expo-camera. Works in Expo Go and in
// the browser (unlike the OS image-picker camera, which only opens a file
// dialog on web). Supports capturing multiple pages before finishing.

import { CameraView, useCameraPermissions } from "expo-camera";
import { Check, RotateCcw, X } from "lucide-react-native";
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { colors, font, radius, spacing } from "../lib/theme";
import type { Page } from "../lib/scanner";

export function CameraModal({
  visible,
  onClose,
  onDone,
}: {
  visible: boolean;
  onClose: () => void;
  onDone: (pages: Page[]) => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const camRef = useRef<CameraView>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [busy, setBusy] = useState(false);
  const [facing, setFacing] = useState<"back" | "front">("back");

  function close() {
    setPages([]);
    onClose();
  }

  async function shoot() {
    if (busy) return;
    setBusy(true);
    try {
      const photo = await camRef.current?.takePictureAsync({ base64: true, quality: 0.7 });
      if (photo?.base64) {
        setPages((p) => [...p, { uri: photo.uri, base64: photo.base64! }]);
      }
    } catch {
      /* ignore a single failed frame */
    } finally {
      setBusy(false);
    }
  }

  function done() {
    const captured = pages;
    setPages([]);
    onDone(captured);
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close} statusBarTranslucent>
      <View style={styles.root}>
        {!permission ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.white} />
          </View>
        ) : !permission.granted ? (
          <View style={styles.center}>
            <Text style={styles.permTitle}>Camera access needed</Text>
            <Text style={styles.permText}>
              DocuMind needs the camera to scan documents. Your browser or device will ask for
              permission.
            </Text>
            <Pressable style={styles.permBtn} onPress={requestPermission}>
              <Text style={styles.permBtnText}>Allow camera</Text>
            </Pressable>
            <Pressable onPress={close} style={{ marginTop: spacing.lg }}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <CameraView ref={camRef} style={StyleSheet.absoluteFill} facing={facing} />

            {/* frame guide */}
            <View pointerEvents="none" style={styles.frame} />

            {/* top bar */}
            <View style={styles.topBar}>
              <Pressable onPress={close} hitSlop={12} style={styles.roundBtn}>
                <X color={colors.white} size={22} />
              </Pressable>
              <Text style={styles.hint}>
                {pages.length === 0
                  ? "Fit the document in the frame"
                  : `${pages.length} page${pages.length > 1 ? "s" : ""} captured`}
              </Text>
              <Pressable
                onPress={() => setFacing((f) => (f === "back" ? "front" : "back"))}
                hitSlop={12}
                style={styles.roundBtn}
              >
                <RotateCcw color={colors.white} size={20} />
              </Pressable>
            </View>

            {/* thumbnails */}
            {pages.length > 0 && (
              <View style={styles.thumbs}>
                {pages.slice(-4).map((p, i) => (
                  <Image key={i} source={{ uri: p.uri }} style={styles.thumb} />
                ))}
              </View>
            )}

            {/* controls */}
            <View style={styles.controls}>
              <View style={styles.sideSlot} />
              <Pressable onPress={shoot} disabled={busy} style={styles.shutterOuter}>
                <View style={styles.shutterInner}>
                  {busy ? <ActivityIndicator color={colors.accent} /> : null}
                </View>
              </Pressable>
              <View style={styles.sideSlot}>
                {pages.length > 0 && (
                  <Pressable onPress={done} style={styles.doneBtn}>
                    <Check color={colors.white} size={22} />
                    <Text style={styles.doneText}>Done</Text>
                  </Pressable>
                )}
              </View>
            </View>
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md },
  permTitle: { fontSize: font.h2, fontWeight: "800", color: colors.white },
  permText: { fontSize: font.body, color: "rgba(255,255,255,0.8)", textAlign: "center", lineHeight: 22 },
  permBtn: {
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    marginTop: spacing.md,
  },
  permBtnText: { color: colors.white, fontWeight: "700", fontSize: font.body },
  cancelText: { color: "rgba(255,255,255,0.7)", fontSize: font.body },
  frame: {
    position: "absolute",
    top: "18%",
    bottom: "22%",
    left: "8%",
    right: "8%",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.7)",
    borderRadius: radius.md,
  },
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingTop: 48,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  roundBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  hint: { color: colors.white, fontSize: font.small, fontWeight: "600" },
  thumbs: { position: "absolute", bottom: 160, left: spacing.lg, flexDirection: "row", gap: 6 },
  thumb: {
    width: 44,
    height: 56,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.6)",
  },
  controls: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingBottom: 44,
    paddingTop: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xl,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  sideSlot: { width: 72, alignItems: "center" },
  shutterOuter: {
    width: 74,
    height: 74,
    borderRadius: 37,
    borderWidth: 4,
    borderColor: colors.white,
    alignItems: "center",
    justifyContent: "center",
  },
  shutterInner: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: colors.white,
    alignItems: "center",
    justifyContent: "center",
  },
  doneBtn: { alignItems: "center", gap: 2 },
  doneText: { color: colors.white, fontSize: font.tiny, fontWeight: "700" },
});
