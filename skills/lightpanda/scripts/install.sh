#!/usr/bin/env bash
set -euo pipefail

# Lightpanda installer — downloads the correct nightly binary for the current OS/arch.
# Supports: Linux x86_64, macOS aarch64 (Apple Silicon)

INSTALL_DIR="${INSTALL_DIR:-/usr/local/bin}"
BINARY_NAME="lightpanda"
BASE_URL="https://github.com/lightpanda-io/browser/releases/download/nightly"

# --- Check if already installed ---
if command -v "$BINARY_NAME" &>/dev/null; then
  echo "✅ Lightpanda is already installed: $(command -v "$BINARY_NAME")"
  "$BINARY_NAME" version 2>/dev/null || true
  echo ""
  echo "To reinstall, remove the existing binary first:"
  echo "  rm $(command -v "$BINARY_NAME")"
  exit 0
fi

# --- Detect OS and architecture ---
OS="$(uname -s)"
ARCH="$(uname -m)"

case "${OS}-${ARCH}" in
  Linux-x86_64)
    ASSET="lightpanda-x86_64-linux"
    ;;
  Darwin-arm64)
    ASSET="lightpanda-aarch64-macos"
    ;;
  Darwin-x86_64)
    echo "❌ macOS x86_64 (Intel) is not supported by Lightpanda."
    echo "   Only Apple Silicon (aarch64) is supported."
    exit 1
    ;;
  Linux-aarch64|Linux-arm64)
    ASSET="lightpanda-aarch64-linux"
    ;;
  *)
    echo "❌ Unsupported platform: ${OS}-${ARCH}"
    echo "   Lightpanda supports: Linux x86_64, Linux aarch64, macOS aarch64"
    exit 1
    ;;
esac

DOWNLOAD_URL="${BASE_URL}/${ASSET}"

echo "🐼 Installing Lightpanda..."
echo "   Platform: ${OS} ${ARCH}"
echo "   URL: ${DOWNLOAD_URL}"
echo "   Target: ${INSTALL_DIR}/${BINARY_NAME}"
echo ""

# --- Download ---
TMP_FILE="$(mktemp)"
trap 'rm -f "$TMP_FILE"' EXIT

echo "⬇️  Downloading..."
if command -v curl &>/dev/null; then
  curl -fSL --progress-bar -o "$TMP_FILE" "$DOWNLOAD_URL"
elif command -v wget &>/dev/null; then
  wget -q --show-progress -O "$TMP_FILE" "$DOWNLOAD_URL"
else
  echo "❌ Neither curl nor wget found. Please install one and retry."
  exit 1
fi

# --- Install ---
chmod +x "$TMP_FILE"

if [ -w "$INSTALL_DIR" ]; then
  mv "$TMP_FILE" "${INSTALL_DIR}/${BINARY_NAME}"
else
  echo "🔐 Need sudo to install to ${INSTALL_DIR}"
  sudo mv "$TMP_FILE" "${INSTALL_DIR}/${BINARY_NAME}"
  sudo chmod +x "${INSTALL_DIR}/${BINARY_NAME}"
fi

# --- Verify ---
echo ""
if command -v "$BINARY_NAME" &>/dev/null; then
  echo "✅ Lightpanda installed successfully!"
  echo "   Location: $(command -v "$BINARY_NAME")"
  "$BINARY_NAME" version 2>/dev/null || true
else
  echo "⚠️  Binary installed to ${INSTALL_DIR}/${BINARY_NAME} but not found on PATH."
  echo "   Add ${INSTALL_DIR} to your PATH, or move the binary."
fi
