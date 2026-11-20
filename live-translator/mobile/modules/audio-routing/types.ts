export type DeviceKind =
  | "builtin_mic"
  | "builtin_speaker"
  | "earpiece"
  | "bluetooth_headset" // HFP/SCO: has a mic, phone-call quality audio
  | "bluetooth_a2dp" // music quality, output only
  | "bluetooth_le" // LE Audio headset
  | "wired"
  | "usb"
  | "other";

export interface AudioDevice {
  /** Stable id for this connection (Android: AudioDeviceInfo id, iOS: port UID or "speaker"/"receiver"). */
  id: string;
  name: string;
  kind: DeviceKind;
  isBluetooth: boolean;
  /** Bluetooth MAC (Android) or port UID (iOS). Used to pair a headset's mic with its speaker. */
  address?: string;
}

export interface DeviceList {
  inputs: AudioDevice[];
  outputs: AudioDevice[];
  /** Input currently used for capture, if known. */
  activeInputId?: string | null;
}

export interface CaptureOptions {
  /** Input device id, or null for the system default (built-in mic). */
  inputDeviceId: string | null;
  /** Use the OS voice-processing path (echo cancellation + noise suppression). */
  voiceProcessing: boolean;
}

export interface SpeakOptions {
  text: string;
  /** BCP-47 locale for the voice, e.g. "de-DE", "ar-SA". */
  locale: string;
  /** Output device id, or null for the current route. */
  outputDeviceId: string | null;
  /** 0.5 – 2.0, 1 = normal. */
  rate: number;
}
