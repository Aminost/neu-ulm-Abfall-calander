// metro.config.js
// https://docs.expo.dev/guides/customizing-metro
//
// NOTE: "expo/metro-config" re-exports everything from "@expo/metro-config".
// We explicitly require both so EAS's heuristic checker (which does a literal
// string scan for "@expo/metro-config") recognises that we extend the default.
const { getDefaultConfig } = require("@expo/metro-config"); // satisfies EAS checker
const { withNativeWind } = require("nativewind/metro");

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// ─────────────────────────────────────────────────────────────────────────────
// FIX: window.addEventListener is not a function on Android
//
// Root cause (two layers):
//
//  1. Package-exports condition resolution:
//     expo-linking v55 ships with a package.json "exports" map that has a
//     "browser" condition pointing to RNLinking.web.js.  Metro (≥ 0.72) reads
//     "exports" by default and, without an explicit conditionNames override,
//     it evaluates "browser" — loading the browser shim on Android.
//
//  2. sourceExts containing "web.*" prefixes:
//     If sourceExts lists "web.js" before "js", Metro finds *.web.js files
//     first when resolving any module, again picking up browser-only code.
//
// Fix 1 — tell Metro which package-exports conditions to honour (native only):
config.resolver.unstable_conditionNames = [
  "react-native", // maps to native implementation
  "require",      // CommonJS interop
  "default",      // catch-all fallback
  // "browser" is intentionally omitted
];

// Apply NativeWind BEFORE cleaning sourceExts, because withNativeWind may
// append entries to the list that we then need to filter out.
const finalConfig = withNativeWind(config, { input: "./global.css" });

// Fix 2 — remove web-prefixed extensions (applied AFTER NativeWind so any
// entries it may have added are also removed).
// Platform-specific file selection (*.web.tsx etc.) is handled automatically
// by resolver.platforms — no manual sourceExts entry is ever needed.
finalConfig.resolver.sourceExts = (finalConfig.resolver.sourceExts ?? []).filter(
  (ext) => !ext.startsWith("web.")
);

module.exports = finalConfig;
