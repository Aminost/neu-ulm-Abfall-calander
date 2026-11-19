import { Tabs, Redirect } from "expo-router";
import { useAppState } from "../../lib/appState";
import { Calendar, Map, Settings } from "lucide-react-native";
import { useTranslation } from "../../lib/i18n";

export default function TabLayout() {
  const { t } = useTranslation();
  const { isLoaded, onboardingDone } = useAppState();

  // Wait for persisted state before deciding where to go (splash covers this).
  if (!isLoaded) return null;
  // First launch → welcome flow instead of the tabs.
  if (!onboardingDone) return <Redirect href="/welcome" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: "#10b981",
        tabBarInactiveTintColor: "#9ca3af",
        tabBarStyle: {
          backgroundColor: "rgba(255,255,255,0.92)",
          borderTopColor: "#e5e7eb",
          borderTopWidth: 1,
          paddingTop: 4,
          paddingBottom: 8,
          height: 60,
        },
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: "500",
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t("home"),
          tabBarIcon: ({ color, size }) => (
            <Calendar size={size} color={color} strokeWidth={2.5} />
          ),
        }}
      />
      <Tabs.Screen
        name="map"
        options={{
          title: t("map"),
          tabBarIcon: ({ color, size }) => (
            <Map size={size} color={color} strokeWidth={2.5} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t("settings"),
          tabBarIcon: ({ color, size }) => (
            <Settings size={size} color={color} strokeWidth={2.5} />
          ),
        }}
      />
    </Tabs>
  );
}
