#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
ARCHIVE="${TMPDIR:-/tmp}/whatsgramy-node-24.22.1.zip"
curl --fail -L --retry 3 https://github.com/fogtape/nodejs-mobile/releases/download/v24.22.1-0/nodejs-mobile-android-24.22.1-0.zip -o "$ARCHIVE"
echo "d6fd9f610fe5d81fede8f0d400c5a62723247725a19831835f15abf4f0604250  $ARCHIVE" | sha256sum -c -
ROOT=android/app/src/main
mkdir -p "$ROOT/cpp/node" "$ROOT/jniLibs"
unzip -q -o "$ARCHIVE" 'include/*' -d "$ROOT/cpp/node"
for ABI in arm64-v8a x86_64; do
 mkdir -p "$ROOT/jniLibs/$ABI"
 unzip -p "$ARCHIVE" "bin/$ABI/libnode.so" > "$ROOT/jniLibs/$ABI/libnode.so"
done
(cd backend && npm ci --omit=dev --ignore-scripts)
rm -rf "$ROOT/assets/engine"
mkdir -p "$ROOT/assets/engine"
cp backend/package.json "$ROOT/assets/engine/"
cp -R backend/src backend/node_modules "$ROOT/assets/engine/"
# Desktop-only optional image codecs cannot load on Android. Baileys media
# downloading does not need them; its optional thumbnail path handles absence.
rm -rf "$ROOT/assets/engine/node_modules/@img" "$ROOT/assets/engine/node_modules/sharp"
find "$ROOT/assets/engine" -type l -delete
