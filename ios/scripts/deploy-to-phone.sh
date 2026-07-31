#!/usr/bin/env bash
# Build TasteCapture and install it straight onto a physical device — no Xcode
# GUI, no waiting for Xcode Cloud.
#
# This is the fast path (~1 min) when you don't want the TestFlight round trip
# (~10 min). This is a paid developer account, so dev builds last until the
# signing certificate expires, not 7 days.
#
#   ./scripts/deploy-to-phone.sh            # first paired device
#   ./scripts/deploy-to-phone.sh <udid>     # a specific device
#
# The Share Extension is embedded in the app, so installing the app installs
# it too — it shows up in the Share Sheet after the first launch.

set -euo pipefail

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

cd "$(dirname "$0")/.."

DERIVED="${TMPDIR:-/tmp}/tastecapture-device-build"

# project.yml is the source of truth; regenerate so a forgotten `xcodegen
# generate` can't ship a stale project to the phone. Byte-stable, so this is a
# no-op when everything is already in sync.
if command -v xcodegen >/dev/null 2>&1; then
  echo "==> Regenerating project from project.yml"
  xcodegen generate --quiet
else
  echo "!! xcodegen not found (brew install xcodegen) — building the committed project as-is" >&2
fi

if [ $# -ge 1 ]; then
  DEVICE="$1"
else
  # Name and model columns both contain spaces, so match the UUID itself
  # rather than counting fields.
  DEVICE=$(xcrun devicectl list devices 2>/dev/null \
    | grep -i iphone | grep -i available \
    | grep -oE '[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}' \
    | head -1)
fi

if [ -z "${DEVICE:-}" ]; then
  echo "No paired iPhone found. Plug one in and unlock it, or pass a UDID:" >&2
  echo "  xcrun devicectl list devices" >&2
  exit 1
fi

echo "==> Building for device $DEVICE"
xcodebuild \
  -project TasteCapture.xcodeproj \
  -scheme TasteCapture \
  -configuration Debug \
  -destination "id=$DEVICE" \
  -derivedDataPath "$DERIVED" \
  -allowProvisioningUpdates \
  build

echo "==> Installing"
xcrun devicectl device install app \
  --device "$DEVICE" \
  "$DERIVED/Build/Products/Debug-iphoneos/TasteCapture.app"

echo "==> Done. Unlock the phone if the app doesn't appear."
echo "    Open it once and paste the key from ~/.config/taste/ios-key."
