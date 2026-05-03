#!/usr/bin/env bash
# cleanup-legacy.sh
# Removes all Vite/web-only artifacts and legacy scripts that are no longer
# needed after the migration to Expo SDK 51 (web + iOS + Android).
#
# Run once from the project root:
#   bash scripts/cleanup-legacy.sh
#
# Safe to run multiple times (guards against missing paths).

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "🧹  Cleaning legacy Vite / web-only files from: $ROOT"

# ── Old Vite web app ──────────────────────────────────────────────────────────
rm -rf src/
rm -rf public/
rm -rf dist/
rm -f  index.html
rm -f  vite.config.ts
rm -f  vite.config.js

# ── Old Expo skeleton (superseded by the current project layout) ──────────────
rm -rf mobile/

# ── Build artefacts / OS noise ───────────────────────────────────────────────
rm -rf .expo/
rm -rf node_modules/.cache/

# ── Legacy data-pipeline scripts (used only during initial data collection) ──
rm -f fetch_recycling.cjs
rm -f fetch_recycling_v2.cjs
rm -f fetch_recycling_v3.cjs
rm -f fetch_recycling_v4.cjs
rm -f fetch_recycling_data.cjs
rm -f geocode_recycling.cjs
rm -f geocode_recycling_v2.cjs
rm -f simplify_zones.cjs
rm -f generate_zones.cjs
rm -f generate_locations.cjs
rm -f check_recycling.cjs
rm -f process_recycling.cjs
rm -f test_fetch.js
rm -f test_ics.js
rm -f find_streets.ts

# ── Intermediate data files (baked into lib/ — not needed at runtime) ─────────
rm -f roads.json
rm -f recycling.json
rm -f metadata.json

# ── Unused app directory (applet sub-route, if present) ──────────────────────
rm -rf app/applet/

# ── Old root Express server (replaced by api/server.ts) ──────────────────────
rm -f server.ts
rm -f server.js

echo ""
echo "✅  Done! The following directories/files were removed (if they existed):"
echo "   src/  public/  dist/  mobile/  index.html  vite.config.ts"
echo "   fetch_*.cjs  geocode_*.cjs  simplify_zones.cjs  generate_*.cjs"
echo "   check_*.cjs  process_recycling.cjs  test_*.js  find_streets.ts"
echo "   roads.json  recycling.json  metadata.json  server.ts  app/applet/"
echo ""
echo "Next steps:"
echo "  1. Run: npx expo start --web          (test web build)"
echo "  2. Run: npx expo start --android      (test Android in emulator)"
echo "  3. Run: npx expo start --ios          (test iOS in simulator)"
echo "  4. Run: eas build --platform all      (EAS cloud build)"
