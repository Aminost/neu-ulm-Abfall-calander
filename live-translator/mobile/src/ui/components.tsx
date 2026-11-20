import React from "react";
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from "react-native";

export const C = {
  bg: "#0E1116",
  card: "#171B22",
  cardHi: "#1F2530",
  border: "#2A313D",
  text: "#F2F4F8",
  dim: "#9AA4B2",
  faint: "#5F6877",
  accent: "#4F8CFF",
  danger: "#FF5D5D",
  ok: "#2BC48A",
  warn: "#FFC145",
};

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function Label({ children }: { children: React.ReactNode }) {
  return <Text style={s.label}>{children}</Text>;
}

export function Chip({
  label,
  selected,
  onPress,
  color = C.accent,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  color?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      style={({ pressed }) => [
        s.chip,
        selected && { backgroundColor: color + "33", borderColor: color },
        pressed && { opacity: 0.7 },
      ]}
    >
      <Text style={[s.chipText, selected && { color: C.text }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

export function Button({
  title,
  onPress,
  kind = "primary",
  disabled,
  style,
}: {
  title: string;
  onPress: () => void;
  kind?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const bg = kind === "primary" ? C.accent : kind === "danger" ? C.danger : C.cardHi;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [s.button, { backgroundColor: bg, opacity: disabled ? 0.4 : pressed ? 0.8 : 1 }, style]}
    >
      <Text style={s.buttonText}>{title}</Text>
    </Pressable>
  );
}

export function Field(props: TextInputProps & { label: string }) {
  const { label, style, ...rest } = props;
  return (
    <View style={{ marginBottom: 12 }}>
      <Label>{label}</Label>
      <TextInput placeholderTextColor={C.faint} autoCapitalize="none" autoCorrect={false} style={[s.input, style]} {...rest} />
    </View>
  );
}

export function Row({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[{ flexDirection: "row", flexWrap: "wrap", gap: 8 }, style]}>{children}</View>;
}

const s = StyleSheet.create({
  card: { backgroundColor: C.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: C.border, marginBottom: 12 },
  label: { color: C.dim, fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 6 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.cardHi,
    maxWidth: 260,
  },
  chipText: { color: C.dim, fontSize: 14, fontWeight: "500" },
  button: { paddingVertical: 14, paddingHorizontal: 20, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  input: {
    backgroundColor: C.cardHi,
    color: C.text,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: C.border,
    fontSize: 15,
  },
});
