import React, { useState } from "react";
import { ScrollView, StyleSheet, Text } from "react-native";
import { engine } from "../engine/ConversationEngine";
import { languageByCode } from "../languages";
import { api } from "../net/api";
import { useStore } from "../store/store";
import { Button, C, Card, Field, Label, Row } from "./components";

export function SessionScreen() {
  const { room, settings, participants } = useStore();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const me = participants[0];

  const create = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.createRoom(settings);
      engine.joinRoom(r.code, me);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={{ backgroundColor: C.bg }} contentContainerStyle={{ padding: 16 }}>
      <Text style={styles.h1}>Multi-phone session</Text>
      <Text style={styles.p}>
        Each person uses their own phone and headset: the best audio quality, no Bluetooth limits, any number of languages. Your phone
        transcribes you; every other phone translates into its owner's language and plays it on their own headset.
      </Text>
      <Text style={styles.p}>
        You join as <Text style={{ color: C.text }}>{me?.name}</Text> ({languageByCode(me?.language ?? "en").name}), Person 1 in
        Setup.
      </Text>

      {room ? (
        <Card>
          <Label>Room code</Label>
          <Text style={styles.code}>{room.code}</Text>
          <Text style={styles.p}>Status: {room.status}</Text>
          <Label>Phones in the room</Label>
          {room.members.map((m) => (
            <Text key={m.id} style={styles.member}>
              • {m.name} · {languageByCode(m.language).name}
            </Text>
          ))}
          <Text style={styles.p}>Go to Conversation and press Start on every phone.</Text>
          <Button title="Leave room" kind="danger" onPress={() => engine.leaveRoom()} />
        </Card>
      ) : (
        <Card>
          <Button title="Create a room" onPress={create} disabled={busy} style={{ marginBottom: 16 }} />
          <Field label="Or join with a code" value={code} onChangeText={(t) => setCode(t.toUpperCase())} placeholder="ABC123" maxLength={6} autoCapitalize="characters" />
          <Row>
            <Button title="Join" kind="secondary" disabled={code.length !== 6} onPress={() => engine.joinRoom(code, me)} style={{ flex: 1 }} />
          </Row>
          {err && <Text style={{ color: C.danger, marginTop: 12 }}>{err}</Text>}
        </Card>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  h1: { color: C.text, fontSize: 22, fontWeight: "800", marginBottom: 8 },
  p: { color: C.dim, marginBottom: 12, lineHeight: 20 },
  code: { color: C.text, fontSize: 40, fontWeight: "800", letterSpacing: 6, marginBottom: 8 },
  member: { color: C.text, fontSize: 15, marginBottom: 4 },
});
