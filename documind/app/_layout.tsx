import * as Notifications from "expo-notifications";
import { router, Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { configureNotifications } from "../src/lib/notifications";
import { colors } from "../src/lib/theme";

export default function RootLayout() {
  useEffect(() => {
    configureNotifications();
    if (Platform.OS === "web") return;
    // Tapping a deadline reminder opens the related document.
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const docId = response.notification.request.content.data?.docId;
      if (typeof docId === "string") router.push(`/document/${docId}`);
    });
    return () => sub.remove();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.bg },
          }}
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="document/[id]"
            options={{ presentation: "card" }}
          />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
