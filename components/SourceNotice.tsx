/**
 * SourceNotice — official-source link + "not affiliated" disclaimer.
 *
 * Google Play's Misleading Claims policy requires apps that show government
 * information (here: the city's waste collection schedule and recycling
 * locations) to link to the official source and state clearly that the app
 * is not an official government app.
 */
import { View, Text, Pressable, Linking } from "react-native";
import { ExternalLink, Info } from "lucide-react-native";
import { useTranslation } from "../lib/i18n";

export const OFFICIAL_SOURCE_URL =
  "https://nu.neu-ulm.de/buerger-service/leben-in-neu-ulm/abfall-sauberkeit/abfallkalender/";

interface Props {
  /** "full" = disclaimer + link (Home, Settings); "compact" = one line (Map). */
  variant?: "full" | "compact";
}

export default function SourceNotice({ variant = "full" }: Props) {
  const { t } = useTranslation();
  const open = () => Linking.openURL(OFFICIAL_SOURCE_URL).catch(() => {});

  if (variant === "compact") {
    return (
      <Pressable
        onPress={open}
        accessibilityRole="link"
        style={{ flexDirection: "row", alignItems: "center", justifyContent: "center",
                 gap: 6, paddingVertical: 6, paddingHorizontal: 16 }}
      >
        <Text style={{ fontSize: 11, color: "#6b7280", textAlign: "center", flexShrink: 1 }}>
          {t("unofficialShort")}{" "}
          <Text style={{ color: "#047857", textDecorationLine: "underline" }}>
            {t("sourceLabel")}: nu.neu-ulm.de
          </Text>
        </Text>
      </Pressable>
    );
  }

  return (
    <View
      style={{ marginHorizontal: 24, marginTop: 24, marginBottom: 16, padding: 14,
               borderRadius: 16, backgroundColor: "#f9fafb", borderWidth: 1,
               borderColor: "#e5e7eb" }}
    >
      <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
        <Info size={16} color="#6b7280" style={{ marginTop: 1 }} />
        <Text style={{ flex: 1, fontSize: 12, lineHeight: 17, color: "#4b5563" }}>
          {t("disclaimer")}
        </Text>
      </View>
      <Pressable
        onPress={open}
        accessibilityRole="link"
        style={({ pressed }) => ({
          flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <ExternalLink size={14} color="#047857" />
        <Text style={{ fontSize: 13, fontWeight: "600", color: "#047857", flexShrink: 1 }}>
          {t("sourceLabel")}: {t("officialSourceName")}
        </Text>
      </Pressable>
    </View>
  );
}
