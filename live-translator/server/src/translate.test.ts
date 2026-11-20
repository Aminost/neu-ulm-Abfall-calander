import { test } from "node:test";
import assert from "node:assert/strict";
import { buildUserMessage, validateRequest } from "./translate.js";

test("validateRequest normalises input", () => {
  const r = validateRequest({ text: "  Hallo  ", languages: ["de", "ar", "de"], targets: ["ar", "xx"] });
  assert.equal(r.text, "Hallo");
  assert.deepEqual(r.languages, ["de", "ar"]);
  assert.deepEqual(r.targets, ["ar"]);
});

test("validateRequest rejects bad input", () => {
  assert.throws(() => validateRequest({ text: "", languages: ["de"] }));
  assert.throws(() => validateRequest({ text: "hi", languages: [] }));
  assert.throws(() => validateRequest({ text: "hi", languages: ["not a code"] }));
});

test("buildUserMessage includes hint, context and utterance", () => {
  const msg = buildUserMessage({
    text: "Wo ist der Bahnhof?",
    sttLanguage: "de",
    languages: ["de", "en"],
    context: [{ language: "en", text: "Hello!" }],
  });
  assert.match(msg, /Conversation languages: de, en/);
  assert.match(msg, /guess: de/);
  assert.match(msg, /\[en\] Hello!/);
  assert.ok(msg.trimEnd().endsWith("Wo ist der Bahnhof?"));
});
