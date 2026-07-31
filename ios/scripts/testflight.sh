#!/usr/bin/env bash
# Archive, export and upload a build to TestFlight from this machine.
#
# This is the ALTERNATIVE to the Xcode Cloud rig. Use it when you'd rather not
# wait for cloud CI, or while the Xcode Cloud workflow isn't set up yet. Xcode
# Cloud remains the primary path (see
# docs/superpowers/specs/2026-07-31-xcode-cloud-testflight-design.md).
#
#   ./scripts/testflight.sh                  # build number = git commit count
#   BUILD_NUMBER=123 ./scripts/testflight.sh # or force one
#
# Requires, one time each:
#
#   1. An App Store Connect app record for no.phareim.tastecapture.
#      The bundle IDs are already registered on the developer portal —
#      automatic signing created them — but the ASC *app record* is separate
#      and can only be created in the web UI.
#
#   2. An App Store Connect API key. There isn't one on this machine (the only
#      .p8 here is sleeper-chat's APNs push key, which is a different thing and
#      will always 401 against this API). Create one at
#      App Store Connect -> Users and Access -> Integrations -> App Store
#      Connect API -> generate a key with App Manager access, then:
#
#        mkdir -p ~/.appstoreconnect/private_keys
#        mv ~/Downloads/AuthKey_XXXXXXXX.p8 ~/.appstoreconnect/private_keys/
#        export ASC_KEY_ID=XXXXXXXX
#        export ASC_ISSUER_ID=<the issuer UUID shown above the key list>
#
#      altool finds the .p8 automatically once it's in that directory.
#
#   3. A distribution certificate. `-allowProvisioningUpdates` creates one on
#      first run if the Xcode account session is valid. (Xcode Cloud doesn't
#      need this — it signs in the cloud — which is why one doesn't exist yet.)

set -euo pipefail

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

cd "$(dirname "$0")/.."

: "${ASC_KEY_ID:?set ASC_KEY_ID (see $0 --help)}"
: "${ASC_ISSUER_ID:?set ASC_ISSUER_ID (see $0 --help)}"

BUILD_DIR="${TMPDIR:-/tmp}/tastecapture-testflight"
ARCHIVE="$BUILD_DIR/TasteCapture.xcarchive"
EXPORT_DIR="$BUILD_DIR/export"

if command -v xcodegen >/dev/null 2>&1; then
  echo "==> Regenerating project from project.yml"
  xcodegen generate --quiet
fi

# App Store Connect permanently rejects a build number it has already seen, so
# every upload needs a fresh one. The commit count is monotonic, meaningful
# (it points at the exact commit shipped) and needs no network or state file.
#
# Re-uploading the same commit is the one case it can't cover — commit again,
# or pass BUILD_NUMBER=n explicitly.
BUILD_NUMBER="${BUILD_NUMBER:-$(git rev-list --count HEAD)}"
echo "==> Build number $BUILD_NUMBER"

rm -rf "$ARCHIVE" "$EXPORT_DIR"

echo "==> Archiving (Release)"
xcodebuild \
  -project TasteCapture.xcodeproj \
  -scheme TasteCapture \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$ARCHIVE" \
  -allowProvisioningUpdates \
  CURRENT_PROJECT_VERSION="$BUILD_NUMBER" \
  archive

# Guard against the version wiring silently regressing: if a plist ever stops
# referencing $(CURRENT_PROJECT_VERSION), the override becomes a no-op and the
# upload fails much later with a confusing duplicate-build error.
APP_PLIST="$ARCHIVE/Products/Applications/TasteCapture.app/Info.plist"
EXT_PLIST="$ARCHIVE/Products/Applications/TasteCapture.app/PlugIns/TasteCaptureShare.appex/Info.plist"
for plist in "$APP_PLIST" "$EXT_PLIST"; do
  got=$(plutil -extract CFBundleVersion raw -o - "$plist")
  if [ "$got" != "$BUILD_NUMBER" ]; then
    echo "Build number didn't take in $(basename "$(dirname "$plist")"): got $got, wanted $BUILD_NUMBER" >&2
    exit 1
  fi
done
echo "==> Verified build number in app and extension"

echo "==> Exporting for App Store Connect"
xcodebuild \
  -exportArchive \
  -archivePath "$ARCHIVE" \
  -exportOptionsPlist ExportOptions.plist \
  -exportPath "$EXPORT_DIR" \
  -allowProvisioningUpdates

IPA=$(find "$EXPORT_DIR" -name '*.ipa' | head -1)
if [ -z "$IPA" ]; then
  echo "No .ipa produced — check the export log above." >&2
  exit 1
fi

echo "==> Validating $IPA"
xcrun altool --validate-app --type ios --file "$IPA" \
  --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID"

echo "==> Uploading"
xcrun altool --upload-app --type ios --file "$IPA" \
  --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID"

# Uploading isn't enough: a build only reaches testers once it's attached to a
# group, and it can't be attached until Apple finishes processing it. Poll,
# then attach — otherwise every release needs a visit to the web UI.
APP_ID="${ASC_APP_ID:-6796821103}"
GROUP_ID="${ASC_GROUP_ID:-dc4b03e1-07ab-456f-ba4d-e21f5c0333d6}"
API=https://api.appstoreconnect.apple.com/v1

echo "==> Waiting for processing"
BUILD_ID=""
for _ in $(seq 1 60); do
  token=$("$(dirname "$0")/asc-token.sh")
  BUILD_ID=$(curl -s -H "Authorization: Bearer $token" \
    "$API/builds?filter%5Bapp%5D=$APP_ID&filter%5Bversion%5D=$BUILD_NUMBER&filter%5BprocessingState%5D=VALID&fields%5Bbuilds%5D=version" \
    | sed -n 's/.*"id" *: *"\([0-9a-f-]\{36\}\)".*/\1/p' | head -1)
  [ -n "$BUILD_ID" ] && break
  sleep 15
done

if [ -z "$BUILD_ID" ]; then
  echo "!! Build $BUILD_NUMBER uploaded but hasn't finished processing." >&2
  echo "   It'll appear in TestFlight shortly; attach it to a group there." >&2
  exit 0
fi

echo "==> Attaching build $BUILD_NUMBER to the tester group"
token=$("$(dirname "$0")/asc-token.sh")
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
  -H "Authorization: Bearer $token" -H 'Content-Type: application/json' \
  -d "{\"data\":[{\"type\":\"builds\",\"id\":\"$BUILD_ID\"}]}" \
  "$API/betaGroups/$GROUP_ID/relationships/builds")
if [ "$code" = "204" ]; then
  echo "==> Done. Build $BUILD_NUMBER is live in TestFlight."
else
  echo "!! Attach returned HTTP $code — add it to the group in App Store Connect." >&2
fi
