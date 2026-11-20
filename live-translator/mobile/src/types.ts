export const AUTO = "auto" as const;

export interface Participant {
  id: string;
  name: string;
  /** ISO 639-1 */
  language: string;
  /** Device id from AudioRouting, or "auto" (phone mic). */
  inputDeviceId: string;
  /** Device id from AudioRouting, or "auto" = the same headset as the input, else the phone speaker. */
  outputDeviceId: string;
  color: string;
}

export interface Settings {
  serverUrl: string;
  appToken: string;
  /** Mute the mic while a translation is being spoken, so the app does not translate itself. */
  halfDuplex: boolean;
  /** After a translation, move the mic to the participant who was just spoken to (they answer next). */
  micHandoff: boolean;
  /** OS echo cancellation / noise suppression. */
  voiceProcessing: boolean;
  speechRate: number;
  /** Also speak the translation aloud (off = subtitles only). */
  speak: boolean;
}

export interface Turn {
  id: string;
  speakerId: string | null;
  speakerName: string;
  language: string;
  original: string;
  translations: { language: string; text: string }[];
  status: "translating" | "done" | "error";
  error?: string;
  at: number;
  latencyMs?: number;
  remote?: boolean;
}
