// Document scanning + PDF conversion.
//
// Primary path: `react-native-document-scanner-plugin`, which opens the OS
// document-scanner UI (Google ML Kit on Android, VisionKit on iOS). It
// auto-detects the page edges, deskews/crops, and returns one cropped image
// per page. That native module is NOT present in Expo Go or on web, so we load
// it lazily and fall back to the system camera / library there.
//
// The scanned pages are then stitched into a single PDF via expo-print.

import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import * as Print from "expo-print";
import { Platform } from "react-native";

// Lazy, crash-proof load of the native scanner.
let DocumentScanner: any = null;
try {
  // @ts-ignore — optional native module; absent in Expo Go / on web.
  DocumentScanner = require("react-native-document-scanner-plugin").default;
} catch {
  DocumentScanner = null;
}

export type ScanSource = "scanner" | "camera" | "library";

export interface ScanResult {
  imageUris: string[];
  source: ScanSource;
}

/** True when the real auto-detecting scanner is usable (native build, not web). */
export function nativeScannerAvailable(): boolean {
  return Boolean(DocumentScanner?.scanDocument) && Platform.OS !== "web";
}

/**
 * Open the document scanner. Auto-detects and crops pages when the native
 * scanner is available; otherwise falls back to the system camera so the
 * button always does something.
 */
export async function scanDocument(): Promise<ScanResult | null> {
  if (nativeScannerAvailable()) {
    try {
      const { scannedImages } = await DocumentScanner.scanDocument({
        maxNumDocuments: 10,
        croppedImageQuality: 90,
      });
      if (!scannedImages || scannedImages.length === 0) return null;
      return { imageUris: scannedImages, source: "scanner" };
    } catch {
      // fall through to the camera fallback below
    }
  }

  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) {
    throw new Error(
      "Camera permission is required to scan. Enable it in your device settings.",
    );
  }
  const res = await ImagePicker.launchCameraAsync({ quality: 0.7, allowsEditing: true });
  if (res.canceled) return null;
  return { imageUris: [res.assets[0].uri], source: "camera" };
}

/** Import one or more images from the photo library. */
export async function pickFromLibrary(): Promise<ScanResult | null> {
  const res = await ImagePicker.launchImageLibraryAsync({
    quality: 0.7,
    mediaTypes: ["images"],
    allowsMultipleSelection: true,
  });
  if (res.canceled) return null;
  return { imageUris: res.assets.map((a) => a.uri), source: "library" };
}

export async function readBase64(uri: string): Promise<string> {
  return FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
}

/** Combine scanned page images into a single PDF file. Returns its uri. */
export async function imagesToPdf(imageUris: string[]): Promise<string> {
  const pages = await Promise.all(
    imageUris.map(async (uri) => {
      const b64 = await readBase64(uri);
      return `<div style="page-break-after:always;text-align:center;">
        <img src="data:image/jpeg;base64,${b64}" style="width:100%;height:auto;" />
      </div>`;
    }),
  );
  const html = `<html><head><meta name="viewport" content="width=device-width" />
    <style>@page{margin:0}body{margin:0;padding:0}</style></head>
    <body>${pages.join("")}</body></html>`;
  const { uri } = await Print.printToFileAsync({ html, base64: false });
  return uri;
}
