#!/usr/bin/env bash
# Creates the release signing key ONCE and prints the values to paste into GitHub secrets.
# Keep crew-tasks-release.jks and the passwords safe (password manager + a backup):
# if you lose them, friends must uninstall the app to install a new build.
set -euo pipefail
OUT="${1:-crew-tasks-release.jks}"
ALIAS="crewtasks"
if [ -e "$OUT" ]; then echo "$OUT already exists — refusing to overwrite." >&2; exit 1; fi
read -rsp "Choose a keystore password (min 6 chars): " PASS; echo
keytool -genkeypair -v -storetype JKS -keystore "$OUT" -alias "$ALIAS" -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass "$PASS" -keypass "$PASS" -dname "CN=Crew Tasks, O=Crew Tasks, C=IN"
echo
echo "Add these GitHub repository secrets (Settings → Secrets and variables → Actions):"
echo "  ANDROID_KEYSTORE_PASSWORD = (the password you typed)"
echo "  ANDROID_KEY_PASSWORD      = (the same password)"
echo "  ANDROID_KEY_ALIAS         = $ALIAS"
echo "  ANDROID_KEYSTORE_BASE64   = contents of ${OUT}.base64 (created now)"
base64 -w0 "$OUT" > "${OUT}.base64" 2>/dev/null || base64 -i "$OUT" -o "${OUT}.base64"
echo
echo "SHA-1 (add it to your Android app in Firebase → Project settings):"
keytool -list -v -keystore "$OUT" -alias "$ALIAS" -storepass "$PASS" | grep -E "SHA1|SHA-1"
