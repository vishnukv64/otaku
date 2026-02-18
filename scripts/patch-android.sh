#!/usr/bin/env bash
# patch-android.sh — Apply custom patches after `tauri android init`
#
# This script is needed because src-tauri/gen/android/ is gitignored and
# regenerated fresh by `tauri android init`. Our customizations:
#   1. MainActivity.kt: Fullscreen bridge (OtakuBridge) + mixed content fix
#   2. RustWebView.kt: Mixed content mode for HTTP video server from HTTPS origin
#
# Usage: ./scripts/patch-android.sh
# Run after: pnpm exec tauri android init

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GEN_ANDROID="$REPO_ROOT/src-tauri/gen/android"
PATCHES="$REPO_ROOT/src-tauri/patches/android"

# Verify Android project exists
if [ ! -d "$GEN_ANDROID/app/src/main/java/com/otaku/player" ]; then
  echo "❌ Android project not found. Run 'pnpm exec tauri android init' first."
  exit 1
fi

# 1. Copy custom MainActivity.kt (fullscreen bridge + mixed content)
echo "Patching MainActivity.kt..."
cp "$PATCHES/MainActivity.kt" \
   "$GEN_ANDROID/app/src/main/java/com/otaku/player/MainActivity.kt"
echo "✅ MainActivity.kt patched"

# 2. Patch RustWebView.kt — add mixedContentMode after javaScriptCanOpenWindowsAutomatically
echo "Patching RustWebView.kt..."
WEBVIEW_FILE="$GEN_ANDROID/app/src/main/java/com/otaku/player/generated/RustWebView.kt"
if grep -q 'mixedContentMode' "$WEBVIEW_FILE"; then
  echo "⏭  RustWebView.kt already has mixedContentMode, skipping"
else
  sed -i.bak 's/settings.javaScriptCanOpenWindowsAutomatically = true/settings.javaScriptCanOpenWindowsAutomatically = true\n        settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW/' "$WEBVIEW_FILE"
  rm -f "$WEBVIEW_FILE.bak"
  echo "✅ RustWebView.kt patched"
fi

echo "✅ All Android patches applied"
