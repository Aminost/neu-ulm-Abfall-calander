import { NativeModule, requireOptionalNativeModule, type EventSubscription } from "expo-modules-core";

import type { CaptureOptions, DeviceList, SpeakOptions } from "./types";
export * from "./types";

type Events = {
  /** 16 kHz mono PCM s16le, base64, ~100 ms per chunk. */
  onAudio(event: { data: string; level: number }): void;
  onDevicesChanged(event: DeviceList): void;
  onRouteError(event: { message: string }): void;
};

declare class AudioRoutingNative extends NativeModule<Events> {
  requestPermissions(): Promise<boolean>;
  getDevices(): DeviceList;
  startCapture(options: CaptureOptions): Promise<void>;
  setInputDevice(inputDeviceId: string | null): Promise<void>;
  stopCapture(): Promise<void>;
  /** Pause/resume sending audio without tearing down the route (used while the app speaks). */
  setCaptureMuted(muted: boolean): void;
  speak(options: SpeakOptions): Promise<void>;
  stopSpeaking(): void;
  availableVoices(): Promise<string[]>;
}

const native = requireOptionalNativeModule<AudioRoutingNative>("AudioRouting");

/** True when running in a dev/production build that includes the native module (not Expo Go / web). */
export const isAvailable = native != null;

function need(): AudioRoutingNative {
  if (!native) throw new Error("AudioRouting native module missing: build a development client (npx expo run:android / run:ios).");
  return native;
}

export const AudioRouting = {
  requestPermissions: () => need().requestPermissions(),
  getDevices: (): DeviceList => (native ? native.getDevices() : { inputs: [], outputs: [] }),
  startCapture: (o: CaptureOptions) => need().startCapture(o),
  setInputDevice: (id: string | null) => need().setInputDevice(id),
  stopCapture: () => (native ? native.stopCapture() : Promise.resolve()),
  setCaptureMuted: (m: boolean) => native?.setCaptureMuted(m),
  speak: (o: SpeakOptions) => need().speak(o),
  stopSpeaking: () => native?.stopSpeaking(),
  availableVoices: () => (native ? native.availableVoices() : Promise.resolve([])),
  addListener<E extends keyof Events>(event: E, fn: Events[E]): EventSubscription {
    if (!native) return { remove() {} };
    return native.addListener(event, fn);
  },
};
