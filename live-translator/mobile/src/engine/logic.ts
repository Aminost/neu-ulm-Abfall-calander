// Pure conversation logic: no React Native imports, so it runs under plain Node tests.
import type { AudioDevice, DeviceList } from "../../modules/audio-routing/types.ts";
import { AUTO, type Participant } from "../types.ts";

// ------------------------------------------------------------ utterance segmentation

export interface SttToken {
  text: string;
  is_final?: boolean;
  speaker?: string | number;
  language?: string;
}

export interface Utterance {
  text: string;
  /** Majority language of the words (from the recognizer). */
  language: string | null;
  /** Recognizer's speaker label (diarization), e.g. "1". */
  speaker: string | null;
}

const isControl = (t: SttToken) => t.text === "<end>" || t.text === "<fin>";

function majority(values: (string | undefined)[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  let n = 0;
  for (const [k, c] of counts) if (c > n) [best, n] = [k, c];
  return best;
}

/**
 * Turns the recognizer's token stream into whole utterances.
 * An utterance ends at an endpoint (<end>, the speaker paused), when the
 * diarized speaker changes, or when the language changes (someone else answered).
 */
export class Segmenter {
  private final: SttToken[] = [];
  partial = "";

  push(tokens: SttToken[]): Utterance[] {
    const out: Utterance[] = [];
    const nonFinal: SttToken[] = [];
    for (const t of tokens) {
      if (!t.is_final) {
        if (!isControl(t)) nonFinal.push(t);
        continue;
      }
      if (isControl(t)) {
        const u = this.flush();
        if (u) out.push(u);
        continue;
      }
      if (this.final.length && this.startsNewTurn(t)) {
        const u = this.flush();
        if (u) out.push(u);
      }
      this.final.push(t);
    }
    this.partial = (this.final.map((t) => t.text).join("") + nonFinal.map((t) => t.text).join("")).trim();
    return out;
  }

  private startsNewTurn(t: SttToken): boolean {
    const words = this.final.filter((x) => x.text.trim());
    if (!words.length || !t.text.trim()) return false;
    const last = words[words.length - 1];
    const speakerChanged = t.speaker != null && last.speaker != null && String(t.speaker) !== String(last.speaker);
    // A new word in another language that starts a new word (leading space) is a strong turn signal.
    const langChanged = !!t.language && !!last.language && t.language !== last.language && /^\s/.test(t.text);
    return speakerChanged || langChanged;
  }

  /** Emit whatever final text is buffered (endpoint, silence timeout, or manual "done"). */
  flush(): Utterance | null {
    const toks = this.final;
    this.final = [];
    const text = toks.map((t) => t.text).join("").trim();
    if (!text) return null;
    const words = toks.filter((t) => t.text.trim());
    return {
      text,
      language: majority(words.map((t) => t.language)),
      speaker: majority(words.map((t) => (t.speaker == null ? undefined : String(t.speaker)))),
    };
  }

  get hasPending() {
    return this.final.length > 0;
  }
}

// ------------------------------------------------------------ who is speaking

export interface SpeakerContext {
  participants: Participant[];
  /** Learned map: recognizer speaker label → participant id. */
  speakerMap: Record<string, string>;
  /** Participant whose mic is currently active (they are the likely speaker). */
  activeParticipantId: string | null;
}

export function resolveSpeaker(u: { language: string | null; speaker: string | null }, ctx: SpeakerContext): Participant | null {
  const { participants, speakerMap, activeParticipantId } = ctx;
  const byId = (id: string | null | undefined) => participants.find((p) => p.id === id);
  const mapped = u.speaker ? byId(speakerMap[u.speaker]) : undefined;
  const active = byId(activeParticipantId);

  const sameLang = u.language ? participants.filter((p) => p.language === u.language) : [];
  if (sameLang.length === 1) return sameLang[0];
  if (sameLang.length > 1) {
    // Several people share the language: voice (diarization) decides, then whose mic is live.
    if (mapped && sameLang.includes(mapped)) return mapped;
    if (active && sameLang.includes(active)) return active;
    return sameLang[0];
  }
  // Language not recognized as anyone's: fall back to the voice, then the live mic.
  return mapped ?? active ?? null;
}

/** Languages to translate an utterance into: everyone else's, without duplicates. */
export function targetLanguages(sourceLanguage: string, participants: Participant[]): string[] {
  return [...new Set(participants.map((p) => p.language))].filter((l) => l !== sourceLanguage);
}

// ------------------------------------------------------------ where to play / listen

export function findDevice(list: AudioDevice[], id: string | null | undefined): AudioDevice | undefined {
  return id && id !== AUTO ? list.find((d) => d.id === id) : undefined;
}

/** Input device for a participant, or null = system default (phone mic). */
export function resolveInput(p: Participant, devices: DeviceList): string | null {
  return findDevice(devices.inputs, p.inputDeviceId)?.id ?? null;
}

/** The headset output that physically belongs to an input (its mic and its earpiece). */
export function matchingOutput(input: AudioDevice | undefined, outputs: AudioDevice[]): AudioDevice | undefined {
  if (!input) return undefined;
  if (input.kind === "builtin_mic") return outputs.find((o) => o.kind === "builtin_speaker");
  const sameAddr = outputs.filter((o) => input.address && o.address === input.address);
  return (
    sameAddr.find((o) => o.kind === input.kind) ??
    sameAddr[0] ??
    outputs.find((o) => o.id === input.id) ??
    outputs.find((o) => o.name === input.name)
  );
}

/**
 * Output for a participant:
 * 1. the device chosen in setup,
 * 2. "auto": the earpiece of the headset they speak into,
 * 3. otherwise the phone speaker.
 */
export function resolveOutput(p: Participant, devices: DeviceList): string | null {
  const chosen = findDevice(devices.outputs, p.outputDeviceId);
  if (chosen) return chosen.id;
  const fromInput = matchingOutput(findDevice(devices.inputs, p.inputDeviceId), devices.outputs);
  if (fromInput) return fromInput.id;
  return devices.outputs.find((o) => o.kind === "builtin_speaker")?.id ?? null;
}

/**
 * Speech jobs for one translated utterance: one per (language, output device).
 * Two listeners with the same language on the same output hear it once.
 */
export function playbackPlan(
  translations: { language: string; text: string }[],
  speakerId: string | null,
  participants: Participant[],
  devices: DeviceList,
): { participantIds: string[]; language: string; text: string; outputDeviceId: string | null }[] {
  const jobs = new Map<string, { participantIds: string[]; language: string; text: string; outputDeviceId: string | null }>();
  for (const p of participants) {
    if (p.id === speakerId) continue;
    const t = translations.find((x) => x.language === p.language);
    if (!t) continue;
    const out = resolveOutput(p, devices);
    const key = `${t.language}|${out}`;
    const job = jobs.get(key);
    if (job) job.participantIds.push(p.id);
    else jobs.set(key, { participantIds: [p.id], language: t.language, text: t.text, outputDeviceId: out });
  }
  return [...jobs.values()];
}
