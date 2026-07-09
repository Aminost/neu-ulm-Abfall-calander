import { useRouter } from "expo-router";
import { Bot, CornerDownLeft, Sparkles, User } from "lucide-react-native";
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { askQuestion, askQuestionStream } from "../../src/api/client";
import { newId } from "../../src/lib/storage";
import { colors, font, radius, spacing } from "../../src/lib/theme";
import type { ChatMessage } from "../../src/lib/types";

const SUGGESTIONS = [
  "What deadlines do I have coming up?",
  "How much do I owe in total?",
  "Summarize my latest document",
  "Any critical issues I should act on?",
];

export default function ChatScreen() {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setInput("");
    const userMsg: ChatMessage = { id: newId(), role: "user", content: q };
    const priorHistory = messages;
    const asstId = newId();
    setMessages([...priorHistory, userMsg, { id: asstId, role: "assistant", content: "", pending: true }]);
    setBusy(true);
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));

    const update = (patch: Partial<ChatMessage>) =>
      setMessages((prev) => prev.map((m) => (m.id === asstId ? { ...m, ...patch } : m)));

    try {
      // Stream the answer token-by-token.
      let acc = "";
      const { citations } = await askQuestionStream(q, priorHistory, (delta) => {
        acc += delta;
        update({ content: acc, pending: false });
        scrollRef.current?.scrollToEnd({ animated: false });
      });
      update({ content: acc || "…", citations, pending: false });
    } catch {
      // Fall back to the non-streaming endpoint (older server / streaming blocked).
      try {
        const { answer, citations } = await askQuestion(q, priorHistory);
        update({ content: answer, citations, pending: false });
      } catch (e) {
        update({
          content: e instanceof Error ? `⚠️ ${e.message}` : "Something went wrong.",
          pending: false,
        });
      }
    } finally {
      setBusy(false);
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Ask your documents</Text>
          <Text style={styles.sub}>Answers are grounded in what you've digitized.</Text>
        </View>

        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          {messages.length === 0 ? (
            <View style={styles.intro}>
              <View style={styles.introIcon}>
                <Sparkles color={colors.accent} size={28} />
              </View>
              <Text style={styles.introTitle}>Retrieval-augmented Q&A</Text>
              <Text style={styles.introText}>
                Ask anything about your documents. DocuMind retrieves the most relevant passages
                and answers with citations.
              </Text>
              <View style={styles.suggestions}>
                {SUGGESTIONS.map((s) => (
                  <Pressable
                    key={s}
                    onPress={() => send(s)}
                    style={({ pressed }) => [styles.suggestion, pressed && { opacity: 0.85 }]}
                  >
                    <Text style={styles.suggestionText}>{s}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : (
            messages.map((m) => <Bubble key={m.id} msg={m} onCite={(id) => router.push(`/document/${id}`)} />)
          )}
        </ScrollView>

        <View style={styles.inputBar}>
          <TextInput
            style={styles.input}
            placeholder="Ask a question…"
            placeholderTextColor={colors.textFaint}
            value={input}
            onChangeText={setInput}
            onSubmitEditing={() => send(input)}
            returnKeyType="send"
            editable={!busy}
            multiline
          />
          <Pressable
            onPress={() => send(input)}
            disabled={busy || !input.trim()}
            style={[styles.sendBtn, (busy || !input.trim()) && { opacity: 0.4 }]}
          >
            {busy ? (
              <ActivityIndicator color={colors.white} size="small" />
            ) : (
              <CornerDownLeft color={colors.white} size={20} />
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Bubble({ msg, onCite }: { msg: ChatMessage; onCite: (id: string) => void }) {
  const isUser = msg.role === "user";
  return (
    <View style={[styles.row, isUser ? styles.rowUser : styles.rowBot]}>
      {!isUser && (
        <View style={styles.avatar}>
          <Bot color={colors.accent} size={16} />
        </View>
      )}
      <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleBot]}>
        {msg.pending ? (
          <ActivityIndicator color={colors.textFaint} size="small" />
        ) : (
          <Text style={[styles.bubbleText, isUser && { color: colors.white }]}>
            {msg.content}
          </Text>
        )}
        {msg.citations && msg.citations.length > 0 && (
          <View style={styles.citations}>
            {msg.citations.map((c, i) => (
              <Pressable
                key={`${c.docId}-${i}`}
                onPress={() => onCite(c.docId)}
                style={({ pressed }) => [styles.citation, pressed && { opacity: 0.8 }]}
              >
                <Text style={styles.citationText} numberOfLines={1}>
                  {c.title}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>
      {isUser && (
        <View style={[styles.avatar, styles.avatarUser]}>
          <User color={colors.white} size={16} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md },
  title: { fontSize: font.h2, fontWeight: "800", color: colors.text },
  sub: { fontSize: font.small, color: colors.textMuted, marginTop: 2 },
  scroll: { padding: spacing.lg, gap: spacing.md, flexGrow: 1 },
  intro: { alignItems: "center", paddingTop: spacing.xl, gap: spacing.sm },
  introIcon: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm,
  },
  introTitle: { fontSize: font.h3, fontWeight: "700", color: colors.text },
  introText: {
    fontSize: font.body,
    color: colors.textMuted,
    textAlign: "center",
    lineHeight: 21,
    paddingHorizontal: spacing.md,
  },
  suggestions: { gap: spacing.sm, alignSelf: "stretch", marginTop: spacing.lg },
  suggestion: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  suggestionText: { fontSize: font.body, color: colors.text, fontWeight: "500" },
  row: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-end" },
  rowUser: { justifyContent: "flex-end" },
  rowBot: { justifyContent: "flex-start" },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarUser: { backgroundColor: colors.accent },
  bubble: { maxWidth: "78%", borderRadius: radius.lg, padding: spacing.md },
  bubbleBot: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderBottomLeftRadius: 4,
  },
  bubbleUser: { backgroundColor: colors.accent, borderBottomRightRadius: 4 },
  bubbleText: { fontSize: font.body, color: colors.text, lineHeight: 21 },
  citations: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: spacing.sm },
  citation: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 4,
    maxWidth: 160,
  },
  citationText: { fontSize: font.tiny, color: colors.accent, fontWeight: "600" },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: font.body,
    color: colors.text,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
});
