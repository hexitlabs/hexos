#!/usr/bin/env bash
set -euo pipefail

# HexOS Phase 2 — Emergency Lockdown: Block ALL egress for a client
# Usage: egress-lockdown.sh <client>

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

export PATH="/usr/sbin:/sbin:${PATH}"

[[ $# -lt 1 ]] && { echo "Usage: egress-lockdown.sh <client>"; exit 1; }

CLIENT="$1"

if [[ ! "$CLIENT" =~ ^[a-z][a-z0-9-]{1,30}[a-z0-9]$ ]]; then
    echo "Error: Invalid client name '${CLIENT}'"
    exit 1
fi

CLIENT_HOME="/hexos/${CLIENT}"

echo "🚨 LOCKDOWN: Blocking ALL egress for client: ${CLIENT}"

# Set lockdown flag (persists across reboots)
mkdir -p "${CLIENT_HOME}/config" 2>/dev/null || true
date -Iseconds > "${CLIENT_HOME}/config/.egress-lockdown"

# Re-apply rules — the apply script detects .egress-lockdown and generates block-all rules
"${SCRIPT_DIR}/egress-apply.sh" "$CLIENT"

# Alert
PLATFORM_DIR="$(dirname "$SCRIPT_DIR")"
if [[ -f "${PLATFORM_DIR}/security/alert.sh" ]]; then
    "${PLATFORM_DIR}/security/alert.sh" "CRITICAL" "$CLIENT" "egress" "LOCKDOWN activated — all outbound traffic blocked"
fi

echo ""
echo "🚨 Client ${CLIENT} is now in LOCKDOWN mode"
echo "  All outbound traffic is BLOCKED (including allowlisted endpoints)"
echo "  The agent process is still running (allows forensic investigation)"
echo "  To restore: hexos egress unlock ${CLIENT}"
