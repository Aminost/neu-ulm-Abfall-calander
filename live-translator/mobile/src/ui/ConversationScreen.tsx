import React, { useEffect, useRef } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useKeepAwake } from "expo-keep-awake";
import { isAvailable } from "../../modules/audio-routing";
import { engine } from "../engine/ConversationEngine";
import { resolveInput, resolveOutput } from "../engine/logic";
import { languageByCode } from "../languages";
import { useStore, type EngineStatus } from "../store/store";
import type { Participant, Turn } from "../types";
import { Button, C } from "./components";

const STATUS: Record<EngineStatus, { label: string; color: string }> = {
  idle: { label: "Ready", color: C.faint },
  starting: { label: "Starting…", color: C.warn },
  listening: { label: "Listening", color: C.ok },
  translating: { label: "Translating…", color: C.accent },
  speaking: { label: "Speaking", color: "#C77DFF" },
  error: { label: "Problem", color: C.danger },
};

function KeepAwake() {
  useKeepAwake();
  return null;
}

function deviceName(id: string | null, list: { id: string; name: string }[], fallback: string) {
  return list.find((d) => d.id === id)?.name ?? fallback;
}

function ParticipantTile({ p, active, level }: { p: Participant; active: boolean; level: number }) {
  const devices = useStore((s) => s.devices);
  const lang = languageByCode(p.language);
  const input = deviceName(resolveInput(p, devices), devices.inputs, "Phone mic");
  const output = deviceName(resolveOutput(p, devices), devices.outputs, "Phone speaker");
  return (
    <Pressable
      onPress={() => engine.setActiveParticipant(p.id)}
      accessibilityLabel={`${p.name}, ${lang.name}. Tap when ${p.name} speaks.`}
      style={[styles.tile, { borderColor: active ? p.color : C.border, backgroundColor: active ? p.color + "1F" : C.card }]}
    >
      <View style={styles.tileHead}>
        <View style={[styles.dot, { backgroundColor: p.color }]} />
        <Text style={styles.tileName} numberOfLines={1}>
          {p.name}
        </Text>
      </View>
      <Text style={styles.tileLang}>{lang.native}</Text>
      <Text style={styles.tileDev} numberOfLines={1}>
        🎙 {input}
      </Text>
      <Text style={styles.tileDev} numberOfLines={1}>
        🔊 {output}
      </Text>
      <View style={styles.meterTrack}>
        <View style={[styles.meter, { width: `${active ? Math.round(level * 100) : 0}%`, backgroundColor: p.color }]} />
      </View>
    </Pressable>
  );
}

function TurnBubble({ t }: { t: Turn }) {
  const participants = useStore((s) => s.participants);
  const p = participants.find((x) => x.id === t.speakerId);
  const color = p?.color ?? C.dim;
  const src = languageByCode(t.language);
  return (
    <View style={[styles.bubble, { borderLeftColor: color }]}>
      <Text style={[styles.who, { color }]}>
        {t.speakerName} · {src.name}
        {t.remote ? " · remote" : ""}
        {t.latencyMs ? ` · ${(t.latencyMs / 1000).toFixed(1)}s` : ""}
      </Text>
      <Text style={[styles.original, src.rtl && styles.rtl]}>{t.original}</Text>
      {t.status === "translating" && <Text style={styles.pending}>Translating…</Text>}
      {t.status === "error" && <Text style={styles.err}>⚠ {t.error}</Text>}
      {t.translations.map((tr) => (
        <View key={tr.language} style={styles.translation}>
          <Text style={styles.trLang}>{languageByCode(tr.language).name}</Text>
          <Text style={[styles.trText, languageByCode(tr.language).rtl && styles.rtl]}>{tr.text}</Text>
        </View>
      ))}
    </View>
  );
}

export function ConversationScreen() {
  const { participants, status, activeParticipantId, level, partial, turns, error, settings, room } = useStore();
  const list = useRef<FlatList<Turn>>(null);
  const running = status !== "idle" && status !== "error";

  useEffect(() => engine.watchDevices(), []);
  useEffect(() => {
    if (turns.length) setTimeout(() => list.current?.scrollToEnd({ animated: true }), 50);
  }, [turns.length, partial]);

  const st = STATUS[status];
  return (
    <View style={styles.root}>
      {running && <KeepAwake />}
      <View style={styles.header}>
        <View style={[styles.statusPill, { borderColor: st.color }]}>
          <View style={[styles.dot, { backgroundColor: st.color }]} />
          <Text style={styles.statusText}>{st.label}</Text>
        </View>
        {room && <Text style={styles.room}>Room {room.code} · {room.members.length} phones</Text>}
      </View>
      {!isAvailable && (
        <Text style={styles.banner}>
          Audio module not found. Run a development build (npx expo run:android / run:ios); Expo Go can't route Bluetooth audio.
        </Text>
      )}
      {error && <Text style={styles.banner}>{error}</Text>}

      <View style={styles.tiles}>
        {participants.map((p) => (
          <ParticipantTile key={p.id} p={p} active={running && p.id === activeParticipantId} level={level} />
        ))}
      </View>

      <FlatList
        ref={list}
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: 8 }}
        data={turns}
        keyExtractor={(t) => t.id}
        renderItem={({ item }) => <TurnBubble t={item} />}
        ListEmptyComponent={
          <Text style={styles.empty}>
            Press Start and talk normally.{"\n"}The app detects who is speaking from the language and voice, translates, and plays it on the other
            person's headset or speaker.{"\n\n"}Tap a person to give them the mic.
          </Text>
        }
        ListFooterComponent={partial ? <Text style={styles.partial}>{partial}</Text> : undefined}
      />

      <View style={styles.controls}>
        {running ? (
          <>
            <Button title="Done ✓" kind="secondary" onPress={() => engine.finishUtterance()} style={{ flex: 1 }} />
            <Button
              title={settings.speak ? "🔊 Voice on" : "🔇 Subtitles"}
              kind="secondary"
              onPress={() => useStore.getState().setSettings({ speak: !settings.speak })}
              style={{ flex: 1 }}
            />
            <Button title="Stop" kind="danger" onPress={() => engine.stop()} style={{ flex: 1 }} />
          </>
        ) : (
          <>
            <Button title="▶  Start conversation" onPress={() => engine.start()} style={{ flex: 3 }} />
            {turns.length > 0 && (
              <Button title="Clear" kind="secondary" onPress={() => useStore.getState().clearTurns()} style={{ flex: 1 }} />
            )}
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 8 },
  statusPill: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  statusText: { color: C.text, fontWeight: "600" },
  room: { color: C.dim, fontSize: 13 },
  banner: { color: C.warn, backgroundColor: "#3A2E10", margin: 16, marginBottom: 0, padding: 10, borderRadius: 10, fontSize: 13 },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: 10, padding: 16, paddingBottom: 4 },
  tile: { flexGrow: 1, flexBasis: "45%", borderRadius: 16, borderWidth: 2, padding: 12 },
  tileHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  tileName: { color: C.text, fontSize: 16, fontWeight: "700", flexShrink: 1 },
  tileLang: { color: C.dim, marginTop: 2, marginBottom: 6 },
  tileDev: { color: C.faint, fontSize: 12 },
  meterTrack: { height: 4, backgroundColor: C.cardHi, borderRadius: 2, marginTop: 8, overflow: "hidden" },
  meter: { height: 4 },
  bubble: { backgroundColor: C.card, borderRadius: 14, padding: 12, marginBottom: 10, borderLeftWidth: 4 },
  who: { fontSize: 12, fontWeight: "700", marginBottom: 4 },
  original: { color: C.dim, fontSize: 15 },
  pending: { color: C.accent, marginTop: 6, fontStyle: "italic" },
  err: { color: C.danger, marginTop: 6 },
  translation: { marginTop: 8 },
  trLang: { color: C.faint, fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
  trText: { color: C.text, fontSize: 20, fontWeight: "600", lineHeight: 27 },
  rtl: { writingDirection: "rtl", textAlign: "right" },
  partial: { color: C.dim, fontSize: 17, fontStyle: "italic", paddingVertical: 8 },
  empty: { color: C.faint, textAlign: "center", marginTop: 32, lineHeight: 22, paddingHorizontal: 12 },
  controls: { flexDirection: "row", gap: 10, padding: 16, borderTopWidth: 1, borderTopColor: C.border },
});
