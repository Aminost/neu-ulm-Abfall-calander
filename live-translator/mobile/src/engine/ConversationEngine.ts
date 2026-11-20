import { PermissionsAndroid, Platform, type Permission } from "react-native";
import { AudioRouting, type DeviceList } from "../../modules/audio-routing";
import { languageByCode } from "../languages";
import { api } from "../net/api";
import { RoomClient, type RemoteUtterance } from "../net/RoomClient";
import { SonioxStream } from "../net/SonioxStream";
import { useStore } from "../store/store";
import type { Participant, Turn } from "../types";
import { Segmenter, playbackPlan, resolveInput, resolveSpeaker, type Utterance } from "./logic";

const SILENCE_FLUSH_MS = 1400;
const UNMUTE_DELAY_MS = 250;

const state = () => useStore.getState();
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

async function ensurePermissions(): Promise<boolean> {
  if (Platform.OS === "android") {
    const perms: Permission[] = [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO];
    if (Number(Platform.Version) >= 31) perms.push(PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT);
    const res = await PermissionsAndroid.requestMultiple(perms);
    return res[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] === "granted";
  }
  return AudioRouting.requestPermissions();
}

/**
 * Orchestrates the live pipeline:
 * mic (chosen Bluetooth/built-in input) → streaming STT with language ID + diarization
 * → who is speaking → translate into everyone else's language → speak each
 * translation on the listener's own output device → hand the mic to whoever answers.
 */
class ConversationEngine {
  private stt: SonioxStream | null = null;
  private seg = new Segmenter();
  private subs: { remove(): void }[] = [];
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private playChain: Promise<void> = Promise.resolve();
  private speakerMap: Record<string, string> = {};
  private currentInput: string | null = null;
  private room: RoomClient | null = null;
  private running = false;
  private speakingCount = 0;

  refreshDevices(): DeviceList {
    const devices = AudioRouting.getDevices();
    state().set({ devices });
    return devices;
  }

  watchDevices() {
    this.refreshDevices();
    const sub = AudioRouting.addListener("onDevicesChanged", (devices) => state().set({ devices }));
    return () => sub.remove();
  }

  get isRunning() {
    return this.running;
  }

  async start() {
    if (this.running) return;
    const s = state();
    s.set({ status: "starting", error: null, partial: "" });
    try {
      if (!(await ensurePermissions())) throw new Error("Microphone permission is required.");
      if (!s.settings.serverUrl) throw new Error("Set the server address in Setup.");
      this.running = true;
      this.speakerMap = {};
      this.seg = new Segmenter();
      const devices = this.refreshDevices();

      const languages = [...new Set(s.participants.map((p) => p.language))];
      if (s.room) for (const m of s.room.members) if (!languages.includes(m.language)) languages.push(m.language);

      this.stt = new SonioxStream({
        getCredentials: () => api.sttToken(state().settings),
        languageHints: languages,
        onTokens: (t) => this.onTokens(t),
        onStatus: (st) => st === "reconnecting" && state().set({ error: "Reconnecting…" }),
        onError: (m) => this.fail(m),
      });

      this.subs.push(
        AudioRouting.addListener("onAudio", ({ data, level }) => {
          this.stt?.sendAudio(data);
          state().set({ level });
        }),
        AudioRouting.addListener("onRouteError", ({ message }) => state().set({ error: message })),
      );

      await this.stt.start();
      const first = s.participants[0];
      const input = first ? resolveInput(first, devices) : null;
      this.currentInput = input;
      await AudioRouting.startCapture({ inputDeviceId: input, voiceProcessing: s.settings.voiceProcessing });
      state().set({ status: "listening", activeParticipantId: first?.id ?? null, error: null });
    } catch (e) {
      this.fail((e as Error).message);
      await this.stop();
    }
  }

  async stop() {
    this.running = false;
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.subs.forEach((x) => x.remove());
    this.subs = [];
    this.stt?.stop();
    this.stt = null;
    AudioRouting.stopSpeaking();
    await AudioRouting.stopCapture().catch(() => {});
    const err = state().status === "error";
    state().set({ status: err ? "error" : "idle", level: 0, partial: "" });
  }

  /** Tap on a participant: "this person is speaking now" → move the mic to their input. */
  async setActiveParticipant(id: string) {
    const p = state().participants.find((x) => x.id === id);
    if (!p) return;
    state().set({ activeParticipantId: id });
    if (!this.running) return;
    const input = resolveInput(p, state().devices);
    if (input !== this.currentInput) {
      this.currentInput = input;
      await AudioRouting.setInputDevice(input).catch((e) => state().set({ error: String(e?.message ?? e) }));
    }
  }

  /** Manual "done speaking": translate now instead of waiting for the pause. */
  finishUtterance() {
    this.stt?.finalize();
  }

  // ------------------------------------------------------------------ recognition

  private onTokens(tokens: Parameters<Segmenter["push"]>[0]) {
    const utterances = this.seg.push(tokens);
    state().set({ partial: this.seg.partial });
    if (this.seg.partial) this.room?.sendPartial(this.seg.partial);
    for (const u of utterances) this.onUtterance(u);
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    if (this.seg.hasPending) {
      this.silenceTimer = setTimeout(() => {
        const u = this.seg.flush();
        state().set({ partial: "" });
        if (u) this.onUtterance(u);
      }, SILENCE_FLUSH_MS);
    }
  }

  private onUtterance(u: Utterance) {
    const s = state();
    const participants = s.participants;
    const speaker = resolveSpeaker(u, {
      participants,
      speakerMap: this.speakerMap,
      activeParticipantId: s.activeParticipantId,
    });
    // Learn which recognizer voice belongs to whom when the language makes it unambiguous.
    if (u.speaker && speaker && participants.filter((p) => p.language === speaker.language).length === 1) {
      this.speakerMap[u.speaker] = speaker.id;
    }
    const roomLangs = s.room?.members.map((m) => m.language) ?? [];
    const languages = [...new Set([...participants.map((p) => p.language), ...roomLangs])];
    this.translateAndPlay({
      id: uid(),
      text: u.text,
      sttLanguage: u.language ?? speaker?.language ?? null,
      languages,
      speaker,
      broadcast: true,
    });
  }

  // ------------------------------------------------------------------ translation + playback

  private translateAndPlay(job: {
    id: string;
    text: string;
    sttLanguage: string | null;
    languages: string[];
    speaker: Participant | null;
    remoteName?: string;
    broadcast: boolean;
  }) {
    const s = state();
    const turn: Turn = {
      id: job.id,
      speakerId: job.speaker?.id ?? null,
      speakerName: job.remoteName ?? job.speaker?.name ?? "Unknown",
      language: job.sttLanguage ?? "?",
      original: job.text,
      translations: [],
      status: "translating",
      at: Date.now(),
      remote: !!job.remoteName,
    };
    s.upsertTurn(turn);
    if (s.status === "listening") s.set({ status: "translating" });

    const context = s.turns.slice(-6).map((t) => ({ language: t.language, text: t.original }));
    const localTargets = [...new Set(s.participants.map((p) => p.language))];
    const started = Date.now();
    const translated = api
      .translate(s.settings, {
        text: job.text,
        sttLanguage: job.sttLanguage,
        languages: job.languages,
        // A remote phone's speech only needs translating into this phone's listeners' languages.
        targets: job.remoteName ? localTargets.filter((l) => l !== job.sttLanguage) : undefined,
        context,
      })
      .then((res) => {
        let speaker = job.speaker;
        if (!job.remoteName && res.sourceLanguage !== speaker?.language) {
          speaker = resolveSpeaker({ language: res.sourceLanguage, speaker: null }, {
            participants: state().participants,
            speakerMap: {},
            activeParticipantId: state().activeParticipantId,
          }) ?? speaker;
        }
        const done: Turn = {
          ...turn,
          speakerId: speaker?.id ?? turn.speakerId,
          speakerName: job.remoteName ?? speaker?.name ?? turn.speakerName,
          language: res.sourceLanguage,
          translations: res.translations,
          status: "done",
          latencyMs: Date.now() - started,
        };
        state().upsertTurn(done);
        if (job.broadcast) this.room?.sendUtterance(job.id, job.text, res.sourceLanguage);
        return done;
      })
      .catch((e) => {
        state().upsertTurn({ ...turn, status: "error", error: (e as Error).message });
        return null;
      });

    // Play in conversation order, even if a later translation comes back first.
    this.playChain = this.playChain.then(async () => {
      const done = await translated;
      if (!done || !this.running) return this.backToListening();
      await this.play(done);
    });
  }

  private async play(turn: Turn) {
    const s = state();
    const jobs = playbackPlan(turn.translations, turn.speakerId, s.participants, s.devices);
    if (s.settings.speak && jobs.length) {
      this.speakingCount++;
      s.set({ status: "speaking" });
      if (s.settings.halfDuplex) AudioRouting.setCaptureMuted(true);
      try {
        for (const j of jobs) {
          await AudioRouting.speak({
            text: j.text,
            locale: languageByCode(j.language).locale,
            outputDeviceId: j.outputDeviceId,
            rate: s.settings.speechRate,
          }).catch((e) => state().set({ error: String(e?.message ?? e) }));
        }
      } finally {
        this.speakingCount--;
        if (this.speakingCount === 0 && s.settings.halfDuplex) {
          await new Promise((r) => setTimeout(r, UNMUTE_DELAY_MS));
          AudioRouting.setCaptureMuted(false);
        }
      }
    }
    // The person who was just addressed usually answers: give them the mic.
    if (s.settings.micHandoff && !turn.remote && jobs.length) {
      const next = jobs[0].participantIds[0];
      if (next) await this.setActiveParticipant(next);
    }
    this.backToListening();
  }

  private backToListening() {
    if (this.running && this.speakingCount === 0) state().set({ status: "listening" });
  }

  private fail(message: string) {
    state().set({ status: "error", error: message });
  }

  // ------------------------------------------------------------------ multi-phone room

  joinRoom(code: string, me: Participant) {
    this.leaveRoom();
    const s = state();
    s.set({ room: { code, members: [], status: "connecting" } });
    this.room = new RoomClient(api.roomUrl(s.settings, code, me.name, me.language), {
      members: (members) => {
        const r = state().room;
        state().set({ room: { code, status: r?.status ?? "connected", members } });
      },
      status: (status, reason) => {
        const r = state().room;
        state().set({ room: { code, members: r?.members ?? [], status: reason ? `${status}: ${reason}` : status } });
      },
      partial: () => {},
      utterance: (u: RemoteUtterance) => this.onRemoteUtterance(u),
    });
    this.room.connect();
  }

  leaveRoom() {
    this.room?.close();
    this.room = null;
    state().set({ room: null });
  }

  private onRemoteUtterance(u: RemoteUtterance) {
    const locals = state().participants.map((p) => p.language);
    if (!locals.some((l) => l !== u.language)) {
      // Everyone on this phone already speaks the speaker's language: show the original only.
      state().upsertTurn({
        id: u.id ?? uid(),
        speakerId: null,
        speakerName: u.from.name,
        language: u.language,
        original: u.text,
        translations: [],
        status: "done",
        at: Date.now(),
        remote: true,
      });
      return;
    }
    this.translateAndPlay({
      id: u.id ?? uid(),
      text: u.text,
      sttLanguage: u.language,
      languages: [...new Set([u.language, ...locals])],
      speaker: null,
      remoteName: u.from.name,
      broadcast: false,
    });
  }
}

export const engine = new ConversationEngine();
