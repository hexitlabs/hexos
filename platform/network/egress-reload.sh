#!/usr/bin/env bash
set -euo pipefail

# HexOS Phase 2 — Hot-reload egress rules without dropping connections
# Preserves established connections by updating rules atomically.
#
# Usage: egress-reload.sh <client>

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

export PATH="/usr/sbin:/sbin:${PATH}"

[[ $# -lt 1 ]] && { echo "Usage: egress-reload.sh <client>"; exit 1; }

CLIENT="$1"

if [[ ! "$CLIENT" =~ ^[a-z][a-z0-9-]{1,30}[a-z0-9]$ ]]; then
    echo "Error: Invalid client name '${CLIENT}'"
    exit 1
fi

TABLE_NAME="hexos_${CLIENT//-/_}"

echo "Hot-reloading egress rules for: ${CLIENT}"

# Check if table exists
if ! nft list table inet "${TABLE_NAME}" &>/dev/null; then
    echo "No existing rules — performing full apply..."
    exec "${SCRIPT_DIR}/egress-apply.sh" "$CLIENT"
fi

# Re-generate and apply (nftables handles atomic replacement)
# The ct state established,related rule ensures existing connections survive
"${SCRIPT_DIR}/egress-apply.sh" "$CLIENT"

echo "✓ Hot-reload complete — established connections preserved"
