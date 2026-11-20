import React, { useState } from "react";
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { engine } from "../engine/ConversationEngine";
import { LANGUAGES, languageByCode } from "../languages";
import { COLORS, newParticipant, useStore } from "../store/store";
import { AUTO, type Participant } from "../types";
import { Button, C, Card, Chip, Field, Label, Row } from "./components";

function LanguagePicker({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  const [open, setOpen] = useState(false);
  const lang = languageByCode(value);
  return (
    <>
      <Chip label={`🌐 ${lang.native} (${lang.name})`} selected onPress={() => setOpen(true)} />
      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <View style={styles.sheetBackdrop}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Language</Text>
            <FlatList
              data={LANGUAGES}
              keyExtractor={(l) => l.code}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => {
                    onChange(item.code);
                    setOpen(false);
                  }}
                  style={[styles.langRow, item.code === value && { backgroundColor: C.cardHi }]}
                >
                  <Text style={styles.langNative}>{item.native}</Text>
                  <Text style={styles.langName}>{item.name}</Text>
                </Pressable>
              )}
            />
            <Button title="Close" kind="secondary" onPress={() => setOpen(false)} />
          </View>
        </View>
      </Modal>
    </>
  );
}

function ParticipantEditor({ p, index, canRemove }: { p: Participant; index: number; canRemove: boolean }) {
  const { devices, updateParticipant, participants, setParticipants } = useStore();
  const set = (patch: Partial<Participant>) => updateParticipant(p.id, patch);
  // A device can only be one person's mic at a time.
  const takenInputs = participants.filter((x) => x.id !== p.id).map((x) => x.inputDeviceId);
  return (
    <Card style={{ borderColor: p.color }}>
      <Row style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <Text style={[styles.pTitle, { color: p.color }]}>Person {index + 1}</Text>
        {canRemove && (
          <Pressable onPress={() => setParticipants(participants.filter((x) => x.id !== p.id))}>
            <Text style={{ color: C.danger }}>Remove</Text>
          </Pressable>
        )}
      </Row>
      <Field label="Name" value={p.name} onChangeText={(name) => set({ name })} autoCapitalize="words" />
      <Label>Speaks</Label>
      <Row style={{ marginBottom: 12 }}>
        <LanguagePicker value={p.language} onChange={(language) => set({ language })} />
      </Row>
      <Label>Microphone (input)</Label>
      <Row style={{ marginBottom: 12 }}>
        <Chip label="Phone mic" selected={p.inputDeviceId === AUTO} onPress={() => set({ inputDeviceId: AUTO })} color={p.color} />
        {devices.inputs
          .filter((d) => d.kind !== "builtin_mic")
          .map((d) => (
            <Chip
              key={d.id}
              label={(takenInputs.includes(d.id) ? "⚠ " : "") + d.name}
              selected={p.inputDeviceId === d.id}
              onPress={() => set({ inputDeviceId: d.id })}
              color={p.color}
            />
          ))}
      </Row>
      <Label>Hears translation on (output)</Label>
      <Row>
        <Chip label="Auto" selected={p.outputDeviceId === AUTO} onPress={() => set({ outputDeviceId: AUTO })} color={p.color} />
        {devices.outputs.map((d) => (
          <Chip key={d.id} label={d.name} selected={p.outputDeviceId === d.id} onPress={() => set({ outputDeviceId: d.id })} color={p.color} />
        ))}
      </Row>
      {p.outputDeviceId === AUTO && (
        <Text style={styles.hint}>Auto: the same headset as this person's mic, otherwise the phone speaker.</Text>
      )}
    </Card>
  );
}

function Toggle({ label, hint, value, onChange }: { label: string; hint: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.toggle}>
      <View style={{ flex: 1, paddingRight: 12 }}>
        <Text style={styles.toggleLabel}>{label}</Text>
        <Text style={styles.hint}>{hint}</Text>
      </View>
      <Switch value={value} onValueChange={onChange} />
    </View>
  );
}

export function SetupScreen() {
  const { participants, setParticipants, settings, setSettings, devices } = useStore();
  const bt = devices.inputs.filter((d) => d.isBluetooth).length + devices.outputs.filter((d) => d.isBluetooth).length;
  return (
    <ScrollView style={{ backgroundColor: C.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
      <Text style={styles.h1}>People</Text>
      <Text style={styles.sub}>
        {bt ? `${bt} Bluetooth audio endpoints connected.` : "No Bluetooth audio connected. Pair headsets in system settings."}{" "}
        <Text style={{ color: C.accent }} onPress={() => engine.refreshDevices()}>
          Refresh
        </Text>
      </Text>
      {participants.map((p, i) => (
        <ParticipantEditor key={p.id} p={p} index={i} canRemove={participants.length > 2} />
      ))}
      {participants.length < 6 && (
        <Button
          title="+ Add person"
          kind="secondary"
          onPress={() => setParticipants([...participants, { ...newParticipant(participants.length, "en"), color: COLORS[participants.length % COLORS.length] }])}
          style={{ marginBottom: 24 }}
        />
      )}

      <Text style={styles.h1}>Behaviour</Text>
      <Card>
        <Toggle
          label="Mute mic while speaking"
          hint="Stops the app from re-translating its own voice. Turn off only if everyone wears headphones."
          value={settings.halfDuplex}
          onChange={(halfDuplex) => setSettings({ halfDuplex })}
        />
        <Toggle
          label="Hand the mic to the listener"
          hint="After a translation, switch to the mic of the person who was spoken to, since they usually answer."
          value={settings.micHandoff}
          onChange={(micHandoff) => setSettings({ micHandoff })}
        />
        <Toggle
          label="Echo & noise cancellation"
          hint="Use the phone's voice processing. Recommended when using the phone speaker."
          value={settings.voiceProcessing}
          onChange={(voiceProcessing) => setSettings({ voiceProcessing })}
        />
        <Label>Voice speed</Label>
        <Row>
          {[0.85, 1, 1.05, 1.2, 1.4].map((r) => (
            <Chip key={r} label={`${r}×`} selected={settings.speechRate === r} onPress={() => setSettings({ speechRate: r })} />
          ))}
        </Row>
      </Card>

      <Text style={styles.h1}>Server</Text>
      <Card>
        <Field
          label="Server address"
          value={settings.serverUrl}
          onChangeText={(serverUrl) => setSettings({ serverUrl })}
          placeholder="https://translator.example.com"
          keyboardType="url"
        />
        <Field
          label="App token"
          value={settings.appToken}
          onChangeText={(appToken) => setSettings({ appToken })}
          placeholder="APP_TOKEN from the server .env"
          secureTextEntry
        />
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  h1: { color: C.text, fontSize: 22, fontWeight: "800", marginBottom: 4, marginTop: 8 },
  sub: { color: C.dim, marginBottom: 12 },
  pTitle: { fontSize: 16, fontWeight: "800" },
  hint: { color: C.faint, fontSize: 12, marginTop: 6 },
  toggle: { flexDirection: "row", alignItems: "center", marginBottom: 16 },
  toggleLabel: { color: C.text, fontSize: 15, fontWeight: "600" },
  sheetBackdrop: { flex: 1, backgroundColor: "#000A", justifyContent: "flex-end" },
  sheet: { backgroundColor: C.card, maxHeight: "80%", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16 },
  sheetTitle: { color: C.text, fontSize: 18, fontWeight: "800", marginBottom: 8 },
  langRow: { paddingVertical: 12, paddingHorizontal: 8, borderRadius: 10, flexDirection: "row", justifyContent: "space-between" },
  langNative: { color: C.text, fontSize: 16 },
  langName: { color: C.dim },
});
