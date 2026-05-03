/**
 * appState.tsx
 *
 * Shared React context for app-wide settings that must stay in sync across
 * all tabs (Home, Settings).  Reading from AsyncStorage in each screen
 * independently caused the Home screen to show stale district/notification
 * state after the user changed settings.
 *
 * This context:
 *  - Loads all persisted values once on mount.
 *  - Exposes typed update helpers that write to both React state AND
 *    AsyncStorage atomically — so every subscribed screen re-renders
 *    immediately without a reload.
 */
import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { storage } from "./storage";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface AppStateValue {
  /** Currently selected Abfuhrbezirk ID (1–8). */
  districtId: number;
  /** Human-readable address shown in the header. */
  address: string;
  /** [lat, lon] of the user's last detected location, or null. */
  coords: [number, number] | null;
  /** Whether push notifications are enabled. */
  notificationsEnabled: boolean;
  /** Time-of-day string for the reminder, e.g. "18:00". */
  reminderTime: string;
  /** True when the district was detected via GPS / address search. */
  districtAutoDetected: boolean;
  /** False until the initial AsyncStorage load completes. */
  isLoaded: boolean;

  /**
   * Update district (and optionally address + autoDetected flag).
   * Persists everything to AsyncStorage.
   */
  updateDistrict: (
    id: number,
    address?: string,
    autoDetected?: boolean
  ) => Promise<void>;

  /**
   * One-call atomic update for everything that follows from a location
   * detection (search-suggestion select, GPS locate, etc.):
   *   district + address + coords + autoDetected flag.
   * Persists each value to AsyncStorage and triggers a single React re-render
   * across all subscribed screens (Home, Map, Settings).
   */
  applyDetectedLocation: (params: {
    districtId: number;
    address: string;
    coords: [number, number];
    autoDetected?: boolean;
  }) => Promise<void>;

  /** Toggle notifications on/off. Persists to AsyncStorage. */
  updateNotifications: (enabled: boolean) => Promise<void>;

  /** Change the daily reminder time. Persists to AsyncStorage. */
  updateReminderTime: (time: string) => Promise<void>;
}

// ── Context ────────────────────────────────────────────────────────────────────

const AppStateContext = createContext<AppStateValue | undefined>(undefined);

// ── Provider ───────────────────────────────────────────────────────────────────

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [districtId,            setDistrictIdState]            = useState(5);
  const [address,               setAddressState]               = useState("");
  const [coords,                setCoordsState]                = useState<[number, number] | null>(null);
  const [notificationsEnabled,  setNotificationsEnabledState]  = useState(false);
  const [reminderTime,          setReminderTimeState]          = useState("18:00");
  const [districtAutoDetected,  setDistrictAutoDetectedState]  = useState(false);
  const [isLoaded,              setIsLoaded]                   = useState(false);

  // ── Initial load ──────────────────────────────────────────────────────────
  // Race the storage read against a 2-second timeout so a slow/broken
  // AsyncStorage layer (rare, but seen in Expo Go on some Android devices)
  // can never block the entire app boot. Defaults are applied when the
  // timeout wins.
  useEffect(() => {
    let cancelled = false;
    const finish = () => {
      if (!cancelled) setIsLoaded(true);
    };

    const failsafe = setTimeout(() => {
      console.warn("[AppState] storage load exceeded 2s — booting with defaults");
      finish();
    }, 2_000);

    Promise.all([
      storage.getItem("selectedDistrict"),
      storage.getItem("userAddress"),
      storage.getItem("userCoords"),
      storage.getItem("remindersEnabled"),
      storage.getItem("reminderTime"),
      storage.getItem("districtAutoDetected"),
    ])
      .then(([district, addr, coordsStr, notifs, time, detected]) => {
        if (cancelled) return;
        if (district)            setDistrictIdState(parseInt(district, 10));
        if (addr)                setAddressState(addr);
        if (coordsStr) {
          try {
            const c = JSON.parse(coordsStr);
            if (Array.isArray(c) && c.length === 2 && c.every((n) => typeof n === "number")) {
              setCoordsState([c[0], c[1]]);
            }
          } catch { /* ignore corrupt cache */ }
        }
        if (notifs === "true")   setNotificationsEnabledState(true);
        if (time)                setReminderTimeState(time);
        if (detected === "true") setDistrictAutoDetectedState(true);
      })
      .catch((err) => {
        console.warn("[AppState] storage load failed:", err);
      })
      .finally(() => {
        clearTimeout(failsafe);
        finish();
      });

    return () => {
      cancelled = true;
      clearTimeout(failsafe);
    };
  }, []);

  // ── Update helpers ────────────────────────────────────────────────────────

  const updateDistrict = useCallback(
    async (id: number, addr?: string, autoDetected?: boolean) => {
      setDistrictIdState(id);
      const saves: Promise<void>[] = [
        storage.setItem("selectedDistrict", String(id)),
      ];
      if (addr !== undefined) {
        setAddressState(addr);
        saves.push(storage.setItem("userAddress", addr));
      }
      if (autoDetected !== undefined) {
        setDistrictAutoDetectedState(autoDetected);
        saves.push(
          storage.setItem("districtAutoDetected", autoDetected ? "true" : "false")
        );
      }
      await Promise.all(saves);
    },
    []
  );

  /**
   * Atomic location update — sets district + address + coords + autoDetected
   * in a single React render so all subscribed screens (Home, Map, Settings)
   * see the change consistently.
   */
  const applyDetectedLocation = useCallback(
    async (params: {
      districtId: number;
      address: string;
      coords: [number, number];
      autoDetected?: boolean;
    }) => {
      const auto = params.autoDetected ?? true;
      console.info(
        `[AppState] applyDetectedLocation:`,
        `\n  districtId: ${params.districtId}`,
        `\n  address:    ${params.address}`,
        `\n  coords:     [${params.coords[0]}, ${params.coords[1]}]`,
        `\n  autoDetected: ${auto}`
      );
      setDistrictIdState(params.districtId);
      setAddressState(params.address);
      setCoordsState(params.coords);
      setDistrictAutoDetectedState(auto);
      await Promise.all([
        storage.setItem("selectedDistrict", String(params.districtId)),
        storage.setItem("userAddress", params.address),
        storage.setItem("userCoords", JSON.stringify(params.coords)),
        storage.setItem("districtAutoDetected", auto ? "true" : "false"),
      ]);
      console.info(`[AppState] applyDetectedLocation: persisted to AsyncStorage`);
    },
    []
  );

  const updateNotifications = useCallback(async (enabled: boolean) => {
    setNotificationsEnabledState(enabled);
    await storage.setItem("remindersEnabled", enabled ? "true" : "false");
  }, []);

  const updateReminderTime = useCallback(async (time: string) => {
    setReminderTimeState(time);
    await storage.setItem("reminderTime", time);
  }, []);

  // ── Value ──────────────────────────────────────────────────────────────────

  return (
    <AppStateContext.Provider
      value={{
        districtId,
        address,
        coords,
        notificationsEnabled,
        reminderTime,
        districtAutoDetected,
        isLoaded,
        updateDistrict,
        applyDetectedLocation,
        updateNotifications,
        updateReminderTime,
      }}
    >
      {children}
    </AppStateContext.Provider>
  );
}

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useAppState(): AppStateValue {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error("useAppState must be used inside <AppStateProvider>");
  return ctx;
}
