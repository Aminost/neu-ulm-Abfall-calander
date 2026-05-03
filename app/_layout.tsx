import "../global.css";
import { useEffect } from "react";
import { LogBox } from "react-native";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { LanguageProvider } from "../lib/i18n";
import { AppStateProvider } from "../lib/appState";
import ErrorBoundary from "../components/ErrorBoundary";
import { configureNotifications } from "../lib/notificationScheduler";

// Hold the native splash visible until our React tree is mounted.
// Failsafe below ensures we never get stuck on the splash forever.
SplashScreen.preventAutoHideAsync().catch(() => {
  /* already hidden — safe to ignore */
});

// Filter dev-only warnings that are harmless for this app:
//
//  • "Android Push notifications … was removed from Expo Go with the release
//    of SDK 53." — fired by expo-notifications' DevicePushTokenAutoRegistration
//    side-effect on import. We use ONLY local scheduled notifications, which
//    still work in Expo Go. The warning disappears in dev builds + production.
//
//  • Reanimated strict-mode noise on first render.
LogBox.ignoreLogs([
  "expo-notifications: Android Push notifications",
  "Reduced motion setting is enabled on this device",
  "[Reanimated]",
]);

export default function RootLayout() {
  useEffect(() => {
    configureNotifications();

    // ── Splash failsafe ──────────────────────────────────────────────────
    // The Home tab also calls hideAsync() on its first onLayout, but if any
    // boot step (AsyncStorage, fonts, fetch) stalls, that callback may never
    // fire and the user is stuck on the splash forever. This guarantees the
    // splash hides within 2.5 seconds regardless of downstream state.
    const failsafe = setTimeout(() => {
      SplashScreen.hideAsync().catch(() => { /* already hidden */ });
    }, 2500);
    return () => clearTimeout(failsafe);
  }, []);

  return (
    <ErrorBoundary>
      <LanguageProvider>
        <AppStateProvider>
          <Stack screenOptions={{ headerShown: false }} />
        </AppStateProvider>
      </LanguageProvider>
    </ErrorBoundary>
  );
}
