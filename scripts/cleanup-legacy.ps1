# cleanup-legacy.ps1
# Removes all Vite/web-only artifacts and legacy scripts no longer needed
# after the migration to Expo SDK 51 (web + iOS + Android).
#
# Run once from the project root:
#   powershell -ExecutionPolicy Bypass -File scripts\cleanup-legacy.ps1

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
Write-Host "Cleaning legacy Vite / web-only files from: $Root" -ForegroundColor Cyan

function Remove-IfExists {
    param([string]$Path)
    if (Test-Path $Path) {
        Remove-Item -Recurse -Force $Path
        Write-Host "  Removed: $Path" -ForegroundColor Green
    }
}

# ── Old Vite web app ──────────────────────────────────────────────────────────
Remove-IfExists "src"
Remove-IfExists "public"
Remove-IfExists "dist"
Remove-IfExists "index.html"
Remove-IfExists "vite.config.ts"
Remove-IfExists "vite.config.js"

# ── Old Expo skeleton (superseded by current project layout) ──────────────────
Remove-IfExists "mobile"

# ── Build artefacts ───────────────────────────────────────────────────────────
Remove-IfExists ".expo"
Remove-IfExists "node_modules\.cache"

# ── Legacy data-pipeline scripts ─────────────────────────────────────────────
$scripts = @(
    "fetch_recycling.cjs", "fetch_recycling_v2.cjs", "fetch_recycling_v3.cjs",
    "fetch_recycling_v4.cjs", "fetch_recycling_data.cjs",
    "geocode_recycling.cjs", "geocode_recycling_v2.cjs",
    "simplify_zones.cjs", "generate_zones.cjs", "generate_locations.cjs",
    "check_recycling.cjs", "process_recycling.cjs",
    "test_fetch.js", "test_ics.js", "find_streets.ts"
)
foreach ($s in $scripts) { Remove-IfExists $s }

# ── Intermediate data files ───────────────────────────────────────────────────
Remove-IfExists "roads.json"
Remove-IfExists "recycling.json"
Remove-IfExists "metadata.json"

# ── Unused app sub-routes ─────────────────────────────────────────────────────
Remove-IfExists "app\applet"

# ── Old root Express server ───────────────────────────────────────────────────
Remove-IfExists "server.ts"
Remove-IfExists "server.js"

Write-Host ""
Write-Host "Done! Legacy files removed." -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:"
Write-Host "  npm install"
Write-Host "  npx expo start --web          # test web build"
Write-Host "  npx expo start --android      # test Android in emulator"
Write-Host "  npx expo start --ios          # test iOS in simulator"
Write-Host "  eas build --platform all      # EAS cloud build (after eas init)"
