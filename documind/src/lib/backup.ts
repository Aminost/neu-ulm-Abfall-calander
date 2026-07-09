// Export / import the whole library as a single JSON file — a portable, personal
// backup the user fully controls. Export shares (or downloads on web) the file;
// import merges documents back in and re-syncs them to the backend.

import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";
import { upsertDocument } from "../api/client";
import { listDocuments, mergeRestored } from "./storage";
import type { DocAnalysis } from "./types";

interface BackupDoc {
  id: string;
  createdAt: number;
  pageCount?: number;
  analysis: DocAnalysis;
}
interface Backup {
  version: number;
  exportedAt: number;
  documents: BackupDoc[];
}

export async function exportLibrary(): Promise<"empty" | "done"> {
  const docs = await listDocuments();
  if (docs.length === 0) return "empty";

  const payload: Backup = {
    version: 1,
    exportedAt: Date.now(),
    documents: docs.map((d) => ({
      id: d.id,
      createdAt: d.createdAt,
      pageCount: d.pageCount,
      analysis: d.analysis,
    })),
  };
  const json = JSON.stringify(payload, null, 2);
  const filename = `documind-backup-${new Date().toISOString().slice(0, 10)}.json`;

  if (Platform.OS === "web") {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    return "done";
  }

  const uri = FileSystem.cacheDirectory + filename;
  await FileSystem.writeAsStringAsync(uri, json);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: "application/json", UTI: "public.json" });
  }
  return "done";
}

/** Pick a backup JSON and merge its documents. Returns how many were added. */
export async function importLibrary(): Promise<number> {
  const res = await DocumentPicker.getDocumentAsync({
    type: ["application/json"],
    copyToCacheDirectory: true,
  });
  if (res.canceled) return 0;
  const uri = res.assets[0].uri;

  const text =
    Platform.OS === "web"
      ? await (await fetch(uri)).text()
      : await FileSystem.readAsStringAsync(uri);

  const parsed = JSON.parse(text) as Partial<Backup>;
  const docs = Array.isArray(parsed.documents) ? parsed.documents : [];
  if (docs.length === 0) throw new Error("No documents found in this file.");

  const added = await mergeRestored(
    docs.map((d) => ({
      docId: d.id,
      title: d.analysis?.title ?? "Untitled",
      createdAt: d.createdAt ?? Date.now(),
      analysis: d.analysis,
    })),
  );

  // Re-sync every imported doc to the backend (for chat/graph + cross-device).
  for (const d of docs) {
    if (d.analysis) {
      upsertDocument({
        id: d.id,
        title: d.analysis.title,
        createdAt: d.createdAt ?? Date.now(),
        analysis: d.analysis,
      }).catch(() => {});
    }
  }
  return added.length;
}
