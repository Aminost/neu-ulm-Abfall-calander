import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { DeviceList } from "../../modules/audio-routing";
import type { RoomMember } from "../net/RoomClient";
import { AUTO, type Participant, type Settings, type Turn } from "../types";

export const COLORS = ["#4F8CFF", "#FF7A59", "#2BC48A", "#C77DFF", "#FFC145", "#FF5D8F"];

const uid = () => Math.random().toString(36).slice(2, 10);

export const newParticipant = (index: number, language: string): Participant => ({
  id: uid(),
  name: `Person ${index + 1}`,
  language,
  inputDeviceId: AUTO,
  outputDeviceId: AUTO,
  color: COLORS[index % COLORS.length],
});

export type EngineStatus = "idle" | "starting" | "listening" | "translating" | "speaking" | "error";

interface State {
  participants: Participant[];
  settings: Settings;
  // runtime (not persisted)
  devices: DeviceList;
  status: EngineStatus;
  activeParticipantId: string | null;
  level: number;
  partial: string;
  turns: Turn[];
  error: string | null;
  room: { code: string; members: RoomMember[]; status: string } | null;

  setParticipants: (p: Participant[]) => void;
  updateParticipant: (id: string, patch: Partial<Participant>) => void;
  setSettings: (patch: Partial<Settings>) => void;
  upsertTurn: (t: Turn) => void;
  clearTurns: () => void;
  set: (patch: Partial<State>) => void;
}

export const useStore = create<State>()(
  persist(
    (set) => ({
      participants: [newParticipant(0, "de"), { ...newParticipant(1, "en"), color: COLORS[1] }],
      settings: {
        serverUrl: process.env.EXPO_PUBLIC_SERVER_URL ?? "http://192.168.0.10:8787",
        appToken: "",
        halfDuplex: true,
        micHandoff: true,
        voiceProcessing: true,
        speechRate: 1.05,
        speak: true,
      },
      devices: { inputs: [], outputs: [] },
      status: "idle",
      activeParticipantId: null,
      level: 0,
      partial: "",
      turns: [],
      error: null,
      room: null,

      setParticipants: (participants) => set({ participants }),
      updateParticipant: (id, patch) =>
        set((s) => ({ participants: s.participants.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),
      setSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
      upsertTurn: (t) =>
        set((s) => {
          const i = s.turns.findIndex((x) => x.id === t.id);
          if (i === -1) return { turns: [...s.turns, t].slice(-200) };
          const turns = s.turns.slice();
          turns[i] = t;
          return { turns };
        }),
      clearTurns: () => set({ turns: [] }),
      set: (patch) => set(patch),
    }),
    {
      name: "live-translator",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ participants: s.participants, settings: s.settings }),
    },
  ),
);
