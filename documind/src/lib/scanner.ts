// Document scanning + PDF conversion, written to work on native AND web.
//
// - The live camera is handled by expo-camera (see components/CameraModal),
//   which works in Expo Go and in the browser.
// - `react-native-document-scanner-plugin` is an optional native module that
//   adds automatic edge-detection in a dev build; it's absent in Expo Go / web,
//   so we load it lazily and fall back to the plain camera.
// - Reading bytes and generating PDFs is done in a platform-safe way so nothing
//   throws in the browser.

import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";
import { getNativeScanner } from "./nativeScanner";

export interface Page {
  uri: string;
  base64: string;
}

// Resolved via a platform-specific module, so the native package is excluded
// from the web bundle entirely.
const DocumentScanner: any = getNativeScanner();

/** True when the auto-detecting native scanner is usable (dev build, not web). */
export function nativeScannerAvailable(): boolean {
  return Boolean(DocumentScanner?.scanDocument) && Platform.OS !== "web";
}

/** Read any uri (file:// on native, blob:/data: on web) as base64 (no data-URI prefix). */
export async function uriToBase64(uri: string): Promise<string> {
  if (Platform.OS === "web") {
    const res = await fetch(uri);
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const s = (reader.result as string) || "";
        resolve(s.includes(",") ? s.split(",")[1] : s);
      };
      reader.onerror = () => reject(new Error("Failed to read file."));
      reader.readAsDataURL(blob);
    });
  }
  return FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
}

export type SaveResult = "saved" | "shared" | "cancelled";

/**
 * Save a PDF to a user-chosen location. On Android, prompts for a folder
 * (Downloads, Documents, …) via the Storage Access Framework and writes the
 * file there — the "target location". On iOS/web, opens the share sheet so the
 * user can save to Files / Drive / Download.
 */
export async function savePdfToDevice(pdfUri: string, filename: string): Promise<SaveResult> {
  if (Platform.OS === "android") {
    const perm = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
    if (!perm.granted) return "cancelled";
    const b64 = await uriToBase64(pdfUri);
    const target = await FileSystem.StorageAccessFramework.createFileAsync(
      perm.directoryUri,
      filename.replace(/\.pdf$/i, ""),
      "application/pdf",
    );
    await FileSystem.writeAsStringAsync(target, b64, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return "saved";
  }
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(pdfUri, { mimeType: "application/pdf", UTI: "com.adobe.pdf" });
    return "shared";
  }
  throw new Error("Saving PDFs isn't supported on this platform.");
}

/** Read any uri as text (platform-safe). */
export async function uriToText(uri: string): Promise<string> {
  if (Platform.OS === "web") {
    const res = await fetch(uri);
    return res.text();
  }
  return FileSystem.readAsStringAsync(uri);
}

/** Auto-detecting scan (native dev build only). Returns cropped page uris. */
export async function scanWithNativeScanner(): Promise<string[] | null> {
  if (!nativeScannerAvailable()) return null;
  const { scannedImages } = await DocumentScanner.scanDocument({
    maxNumDocuments: 10,
    croppedImageQuality: 90,
  });
  return scannedImages && scannedImages.length > 0 ? scannedImages : null;
}

/** Import one or more images from the library, with base64 for each. */
export async function pickImagesFromLibrary(): Promise<Page[] | null> {
  const res = await ImagePicker.launchImageLibraryAsync({
    quality: 0.7,
    base64: true,
    mediaTypes: ["images"],
    allowsMultipleSelection: true,
  });
  if (res.canceled) return null;
  return Promise.all(
    res.assets.map(async (a) => ({
      uri: a.uri,
      base64: a.base64 ?? (await uriToBase64(a.uri)),
    })),
  );
}

/**
 * Combine page images into a single PDF via expo-print. Native only —
 * printing to a file isn't supported on web, so callers should treat a
 * rejection as "no PDF" rather than an error.
 */
export async function imagesToPdf(pagesBase64: string[]): Promise<string> {
  if (Platform.OS === "web") throw new Error("PDF generation is not available on web.");
  const body = pagesBase64
    .map(
      (b64) =>
        `<div style="page-break-after:always;text-align:center;">
           <img src="data:image/jpeg;base64,${b64}" style="width:100%;height:auto;" />
         </div>`,
    )
    .join("");
  const html = `<html><head><meta name="viewport" content="width=device-width" />
    <style>@page{margin:0}body{margin:0;padding:0}</style></head><body>${body}</body></html>`;
  const { uri } = await Print.printToFileAsync({ html, base64: false });
  return uri;
}
