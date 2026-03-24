#!/usr/bin/env bash
set -euo pipefail

# HexOS Phase 2 — Remove all nftables egress rules for a client
# Usage: egress-remove.sh <client>

export PATH="/usr/sbin:/sbin:${PATH}"

[[ $# -lt 1 ]] && { echo "Usage: egress-remove.sh <client>"; exit 1; }

CLIENT="$1"

if [[ ! "$CLIENT" =~ ^[a-z][a-z0-9-]{1,30}[a-z0-9]$ ]]; then
    echo "Error: Invalid client name '${CLIENT}'"
    exit 1
fi

TABLE_NAME="hexos_${CLIENT//-/_}"
CLIENT_HOME="/hexos/${CLIENT}"

echo "Removing egress rules for client: ${CLIENT}"

# Delete the nftables table
if nft list table inet "${TABLE_NAME}" &>/dev/null; then
    nft delete table inet "${TABLE_NAME}"
    echo "✓ Deleted nftables table: inet ${TABLE_NAME}"
else
    echo "  No nftables table found for ${CLIENT} (already clean)"
fi

# Clean up generated rules file
GENERATED_FILE="/hexos/platform/config/generated/${CLIENT}-egress.nft"
if [[ -f "$GENERATED_FILE" ]]; then
    rm -f "$GENERATED_FILE"
    echo "✓ Removed generated rules file"
fi

# Clean up DNS cache for this client's hosts
if [[ -f "${CLIENT_HOME}/config/egress.yaml" ]]; then
    echo "  Note: egress.yaml preserved (remove manually if needed)"
fi

# Remove lockdown flag if present
rm -f "${CLIENT_HOME}/config/.egress-lockdown" 2>/dev/null || true
rm -f "${CLIENT_HOME}/config/.egress-applied" 2>/dev/null || true

echo "✓ Egress rules removed for ${CLIENT}"
