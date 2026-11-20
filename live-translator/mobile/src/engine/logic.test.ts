import { test } from "node:test";
import assert from "node:assert/strict";
import { Segmenter, playbackPlan, resolveOutput, resolveSpeaker, targetLanguages } from "./logic.ts";
import type { DeviceList } from "../../modules/audio-routing/types.ts";
import type { Participant } from "../types.ts";

const amine: Participant = { id: "a", name: "Amine", language: "ar", inputDeviceId: "10", outputDeviceId: "auto", color: "#000" };
const lena: Participant = { id: "l", name: "Lena", language: "de", inputDeviceId: "auto", outputDeviceId: "auto", color: "#000" };
const tom: Participant = { id: "t", name: "Tom", language: "de", inputDeviceId: "auto", outputDeviceId: "21", color: "#000" };

const devices: DeviceList = {
  inputs: [
    { id: "1", name: "Phone microphone", kind: "builtin_mic", isBluetooth: false },
    { id: "10", name: "Buds (headset)", kind: "bluetooth_headset", isBluetooth: true, address: "AA" },
  ],
  outputs: [
    { id: "2", name: "Phone speaker", kind: "builtin_speaker", isBluetooth: false },
    { id: "11", name: "Buds (media)", kind: "bluetooth_a2dp", isBluetooth: true, address: "AA" },
    { id: "12", name: "Buds (headset)", kind: "bluetooth_headset", isBluetooth: true, address: "AA" },
    { id: "21", name: "Speaker box (media)", kind: "bluetooth_a2dp", isBluetooth: true, address: "BB" },
  ],
};

test("segmenter emits utterance at endpoint and keeps majority language", () => {
  const s = new Segmenter();
  assert.deepEqual(s.push([{ text: "Hal", is_final: false }]), []);
  assert.equal(s.partial, "Hal");
  const out = s.push([
    { text: "Hallo", is_final: true, language: "de", speaker: "1" },
    { text: " wie", is_final: true, language: "de", speaker: "1" },
    { text: " geht's?", is_final: true, language: "de", speaker: "1" },
    { text: "<end>", is_final: true },
  ]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], { text: "Hallo wie geht's?", language: "de", speaker: "1" });
  assert.equal(s.hasPending, false);
});

test("segmenter splits when the speaker or language changes", () => {
  const s = new Segmenter();
  const out = s.push([
    { text: "Danke", is_final: true, language: "de", speaker: "1" },
    { text: " شكرا", is_final: true, language: "ar", speaker: "2" },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].text, "Danke");
  assert.deepEqual(s.flush(), { text: "شكرا", language: "ar", speaker: "2" });
});

test("speaker is found by language, then by voice when languages are shared", () => {
  const ctx = { participants: [amine, lena, tom], speakerMap: { "3": "t" }, activeParticipantId: "l" };
  assert.equal(resolveSpeaker({ language: "ar", speaker: "1" }, ctx)?.id, "a");
  assert.equal(resolveSpeaker({ language: "de", speaker: "3" }, ctx)?.id, "t");
  assert.equal(resolveSpeaker({ language: "de", speaker: "9" }, ctx)?.id, "l");
  assert.equal(resolveSpeaker({ language: "fr", speaker: "3" }, ctx)?.id, "t");
});

test("targets are everyone else's languages", () => {
  assert.deepEqual(targetLanguages("de", [amine, lena, tom]), ["ar"]);
  assert.deepEqual(targetLanguages("ar", [amine, lena, tom]), ["de"]);
});

test("auto output follows the participant's headset; manual choice wins", () => {
  assert.equal(resolveOutput(amine, devices), "12"); // mic of Buds → earpiece of Buds
  assert.equal(resolveOutput(lena, devices), "2"); // no headset → phone speaker
  assert.equal(resolveOutput(tom, devices), "21");
});

test("playback plan groups listeners by language and device", () => {
  const plan = playbackPlan([{ language: "de", text: "Hallo" }], "a", [amine, lena, tom], devices);
  assert.deepEqual(plan, [
    { participantIds: ["l"], language: "de", text: "Hallo", outputDeviceId: "2" },
    { participantIds: ["t"], language: "de", text: "Hallo", outputDeviceId: "21" },
  ]);
});
