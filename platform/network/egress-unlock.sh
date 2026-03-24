#!/usr/bin/env bash
set -euo pipefail

# HexOS Phase 2 — Unlock: Restore normal egress policy after lockdown
# Usage: egress-unlock.sh <client>

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

export PATH="/usr/sbin:/sbin:${PATH}"

[[ $# -lt 1 ]] && { echo "Usage: egress-unlock.sh <client>"; exit 1; }

CLIENT="$1"

if [[ ! "$CLIENT" =~ ^[a-z][a-z0-9-]{1,30}[a-z0-9]$ ]]; then
    echo "Error: Invalid client name '${CLIENT}'"
    exit 1
fi

CLIENT_HOME="/hexos/${CLIENT}"
LOCKDOWN_FILE="${CLIENT_HOME}/config/.egress-lockdown"

if [[ ! -f "$LOCKDOWN_FILE" ]]; then
    echo "Client ${CLIENT} is not in lockdown mode"
    exit 0
fi

echo "Unlocking egress for client: ${CLIENT}"

# Remove lockdown flag
rm -f "$LOCKDOWN_FILE"

# Re-apply normal policy
"${SCRIPT_DIR}/egress-apply.sh" "$CLIENT"

# Alert
PLATFORM_DIR="$(dirname "$SCRIPT_DIR")"
if [[ -f "${PLATFORM_DIR}/security/alert.sh" ]]; then
    "${PLATFORM_DIR}/security/alert.sh" "WARNING" "$CLIENT" "egress" "LOCKDOWN lifted — normal egress policy restored"
fi

echo ""
echo "✓ Client ${CLIENT} unlocked — normal egress policy restored"
