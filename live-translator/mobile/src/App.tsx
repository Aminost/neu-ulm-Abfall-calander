import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { ConversationScreen } from "./ui/ConversationScreen";
import { SessionScreen } from "./ui/SessionScreen";
import { SetupScreen } from "./ui/SetupScreen";
import { C } from "./ui/components";

const TABS = [
  { key: "talk", label: "Conversation", icon: "💬" },
  { key: "setup", label: "Setup", icon: "🎧" },
  { key: "session", label: "Multi-phone", icon: "📱" },
] as const;

type Tab = (typeof TABS)[number]["key"];

export default function App() {
  const [tab, setTab] = useState<Tab>("talk");
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
        <View style={{ flex: 1 }}>
          {tab === "talk" && <ConversationScreen />}
          {tab === "setup" && <SetupScreen />}
          {tab === "session" && <SessionScreen />}
        </View>
        <View style={styles.tabs}>
          {TABS.map((t) => (
            <Pressable key={t.key} onPress={() => setTab(t.key)} style={styles.tab} accessibilityRole="tab" accessibilityState={{ selected: tab === t.key }}>
              <Text style={styles.icon}>{t.icon}</Text>
              <Text style={[styles.tabText, tab === t.key && { color: C.text }]}>{t.label}</Text>
            </Pressable>
          ))}
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  tabs: { flexDirection: "row", borderTopWidth: 1, borderTopColor: C.border, backgroundColor: C.card },
  tab: { flex: 1, alignItems: "center", paddingVertical: 8 },
  icon: { fontSize: 20 },
  tabText: { color: C.faint, fontSize: 12, marginTop: 2, fontWeight: "600" },
});
