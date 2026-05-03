/**
 * Thin wrapper over AsyncStorage so the rest of the codebase uses a familiar
 * synchronous-looking API without directly importing from async-storage everywhere.
 *
 * All methods return Promises — callers should await them or handle via .then().
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

export const storage = {
  getItem: (key: string): Promise<string | null> =>
    AsyncStorage.getItem(key),

  setItem: (key: string, value: string): Promise<void> =>
    AsyncStorage.setItem(key, value),

  removeItem: (key: string): Promise<void> =>
    AsyncStorage.removeItem(key),

  /** Read a JSON-encoded value, returns null if missing or malformed. */
  getJson: async <T>(key: string): Promise<T | null> => {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  },

  /** Write a value as JSON. */
  setJson: <T>(key: string, value: T): Promise<void> =>
    AsyncStorage.setItem(key, JSON.stringify(value)),
};
