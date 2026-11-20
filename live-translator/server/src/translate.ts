import Anthropic from "@anthropic-ai/sdk";

export interface TranslateRequest {
  /** Transcribed utterance. */
  text: string;
  /** Language the speech recognizer reported (ISO 639-1), if any. */
  sttLanguage?: string | null;
  /** Languages spoken in this conversation (ISO 639-1). The source is one of them. */
  languages: string[];
  /** Languages to translate into. Defaults to every conversation language except the detected source. */
  targets?: string[];
  /** A few recent utterances, oldest first, so pronouns and terms stay consistent. */
  context?: { language: string; text: string }[];
}

export interface TranslateResult {
  sourceLanguage: string;
  translations: { language: string; text: string }[];
}

const SYSTEM_PROMPT = `You are the translation engine of a live, spoken, two-way conversation interpreter.
Each request is one utterance that a speech recognizer just transcribed. The translations are read aloud by text-to-speech to the other people in the conversation.

1. Decide which of the conversation languages the utterance is in. The recognizer's guess is a hint, not the truth; trust the words themselves.
2. Translate the utterance into every requested target language.

Translate the way a skilled human interpreter speaks: natural, spoken register, same tone and politeness level, short sentences. Keep names, numbers and addresses exact. Silently fix obvious speech-recognition errors when the intended meaning is clear from context. Do not add explanations, notes, quotes or anything that is not a translation, because everything you write is spoken aloud. If the utterance is only filler ("uh", "hmm"), return it unchanged as a short filler in each target language.`;

function schemaFor(languages: string[]) {
  return {
    type: "object",
    properties: {
      source_language: { type: "string", enum: languages },
      translations: {
        type: "array",
        items: {
          type: "object",
          properties: {
            language: { type: "string", enum: languages },
            text: { type: "string" },
          },
          required: ["language", "text"],
          additionalProperties: false,
        },
      },
    },
    required: ["source_language", "translations"],
    additionalProperties: false,
  } as const;
}

export function buildUserMessage(req: TranslateRequest): string {
  const lines: string[] = [];
  lines.push(`Conversation languages: ${req.languages.join(", ")}`);
  if (req.targets?.length) lines.push(`Translate into: ${req.targets.join(", ")}`);
  else lines.push(`Translate into: every conversation language except the source language`);
  if (req.sttLanguage) lines.push(`Recognizer's language guess: ${req.sttLanguage}`);
  if (req.context?.length) {
    lines.push("Recent conversation (for context only, do not translate):");
    for (const c of req.context.slice(-6)) lines.push(`[${c.language}] ${c.text}`);
  }
  lines.push("", "Utterance to translate:", req.text);
  return lines.join("\n");
}

export function validateRequest(body: unknown): TranslateRequest {
  const b = body as Partial<TranslateRequest> | null;
  if (!b || typeof b.text !== "string" || !b.text.trim()) throw new Error("text is required");
  if (b.text.length > 4000) throw new Error("text too long");
  if (!Array.isArray(b.languages) || b.languages.length < 1 || b.languages.length > 8)
    throw new Error("languages must list 1-8 language codes");
  const code = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/;
  const languages = [...new Set(b.languages)];
  if (!languages.every((l) => typeof l === "string" && code.test(l))) throw new Error("invalid language code");
  const targets = b.targets?.filter((t) => languages.includes(t));
  return {
    text: b.text.trim(),
    sttLanguage: typeof b.sttLanguage === "string" ? b.sttLanguage : null,
    languages,
    targets: targets?.length ? targets : undefined,
    context: Array.isArray(b.context)
      ? b.context
          .filter((c) => c && typeof c.text === "string" && typeof c.language === "string")
          .slice(-6)
          .map((c) => ({ language: c.language, text: c.text.slice(0, 500) }))
      : undefined,
  };
}

export class Translator {
  private client = new Anthropic();
  constructor(private model = process.env.TRANSLATION_MODEL || "claude-opus-5-5") {}

  async translate(req: TranslateRequest): Promise<TranslateResult> {
    const response = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      // If the model declines a request, the API retries it on a fallback model in the same call.
      fallbacks: "default",
      // Live speech: keep reasoning short so the translation comes back fast.
      output_config: { effort: "low", format: { type: "json_schema", schema: schemaFor(req.languages) } },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserMessage(req) }],
    });

    if (response.stop_reason === "refusal") throw new Error("translation declined");
    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") throw new Error("empty translation");
    const parsed = JSON.parse(text.text) as {
      source_language: string;
      translations: { language: string; text: string }[];
    };
    const wanted = req.targets ?? req.languages.filter((l) => l !== parsed.source_language);
    return {
      sourceLanguage: parsed.source_language,
      translations: parsed.translations.filter(
        (t) => t.language !== parsed.source_language && wanted.includes(t.language) && t.text.trim(),
      ),
    };
  }
}
