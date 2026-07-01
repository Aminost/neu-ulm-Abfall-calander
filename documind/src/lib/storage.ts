// Local-first document storage. Document metadata + analysis live in
// AsyncStorage; the page image is copied into the app's document directory so
// it persists independently of the OS cache. This is the "save to local /
// device storage" target the app defaults to.

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import type { DocumentRecord } from "./types";

const INDEX_KEY = "documind.documents.v1";
const SETTINGS_KEY = "documind.settings.v1";
const IMAGE_DIR = FileSystem.documentDirectory + "documind/";

export interface Settings {
  apiUrl: string;
}

async function ensureDir() {
  const info = await FileSystem.getInfoAsync(IMAGE_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(IMAGE_DIR, { intermediates: true });
  }
}

/** Copy a transient capture/import into permanent app storage. Returns the new uri. */
export async function persistFile(sourceUri: string, id: string, ext: string): Promise<string> {
  try {
    await ensureDir();
    const dest = `${IMAGE_DIR}${id}.${ext}`;
    await FileSystem.copyAsync({ from: sourceUri, to: dest });
    return dest;
  } catch {
    // Fall back to the original uri if copying fails (e.g. web).
    return sourceUri;
  }
}

export async function persistImage(sourceUri: string, id: string): Promise<string> {
  const ext = sourceUri.split(".").pop()?.split("?")[0] || "jpg";
  return persistFile(sourceUri, id, ext);
}

export async function listDocuments(): Promise<DocumentRecord[]> {
  const raw = await AsyncStorage.getItem(INDEX_KEY);
  if (!raw) return [];
  try {
    const docs = JSON.parse(raw) as DocumentRecord[];
    return docs.sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

export async function getDocument(id: string): Promise<DocumentRecord | undefined> {
  const docs = await listDocuments();
  return docs.find((d) => d.id === id);
}

async function writeAll(docs: DocumentRecord[]): Promise<void> {
  await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(docs));
}

export async function saveDocument(doc: DocumentRecord): Promise<void> {
  const docs = await listDocuments();
  const idx = docs.findIndex((d) => d.id === doc.id);
  if (idx >= 0) docs[idx] = doc;
  else docs.push(doc);
  await writeAll(docs);
}

export async function deleteDocument(id: string): Promise<void> {
  const docs = await listDocuments();
  const doc = docs.find((d) => d.id === id);
  for (const uri of [doc?.imageUri, doc?.pdfUri]) {
    if (uri && uri.startsWith(IMAGE_DIR)) {
      try {
        await FileSystem.deleteAsync(uri, { idempotent: true });
      } catch {
        /* ignore */
      }
    }
  }
  await writeAll(docs.filter((d) => d.id !== id));
}

export async function getSettings(): Promise<Settings> {
  const raw = await AsyncStorage.getItem(SETTINGS_KEY);
  const fallback: Settings = {
    apiUrl: process.env.EXPO_PUBLIC_API_URL || "http://localhost:3001",
  };
  if (!raw) return fallback;
  try {
    return { ...fallback, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return fallback;
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
