#!/usr/bin/env bash
set -euo pipefail
# HexOS Mode — Show current deployment profile and security status

HEXOS_CONFIG="/hexos/platform/config/hexos.yaml"

if [[ ! -f "$HEXOS_CONFIG" ]]; then
    echo "HexOS is not configured yet."
    echo "Run 'hexos setup' to choose a deployment profile."
    exit 1
fi

MODE=$(grep -oP '^\s+mode:\s+\K\w+' "$HEXOS_CONFIG" 2>/dev/null || echo "unknown")
VERSION=$(grep -oP '^\s+version:\s+"\K[^"]+' "$HEXOS_CONFIG" 2>/dev/null || echo "unknown")

echo "╔══════════════════════════════════════════════════╗"
echo "║  HexOS Deployment Profile                         ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
echo "  Mode:    ${MODE^^}"
echo "  Version: ${VERSION}"
echo "  Config:  ${HEXOS_CONFIG}"
echo ""

# Read security flags
get_flag() {
    local key="$1" default="${2:-false}"
    grep -oP "^\s+${key}:\s+\K\w+" "$HEXOS_CONFIG" 2>/dev/null || echo "$default"
}

JAIL=$(get_flag "workspace_jail" "false")
SCAN=$(get_flag "pre_scan" "false")
EGRESS=$(get_flag "egress_control" "false")
DOCKER=$(get_flag "docker_sandbox" "false")
INFERENCE=$(get_flag "inference_policy" "false")
AUDIT=$(get_flag "audit_trail" "false")

icon() { [[ "$1" == "true" ]] && echo "✅" || echo "❌"; }

echo "  Security Stack:"
echo "    $(icon $JAIL) Workspace Jail (Phase 1)"
echo "    $(icon $SCAN) Pre-Runtime Scanner (Phase 1.5)"
echo "    $(icon $EGRESS) Network Egress Control (Phase 2)"
echo "    $(icon $DOCKER) Docker Sandbox (Phase 3)"
echo "    $(icon $INFERENCE) Inference Policy (Phase 5)"
echo "    $(icon $AUDIT) Audit Trail (Phase 6)"
echo ""

if [[ "$MODE" == "operator" ]]; then
    echo "  ⚡ Operator mode — full access, no restrictions"
    echo "  Scanner available on-demand: hexos security scan <path>"
elif [[ "$MODE" == "managed" ]]; then
    # Count clients
    CLIENT_COUNT=0
    if [[ -f "/hexos/platform/config/clients.yaml" ]]; then
        CLIENT_COUNT=$(grep -c "^  - name:" /hexos/platform/config/clients.yaml 2>/dev/null || echo "0")
    fi
    echo "  🔒 Managed mode — security stack active"
    echo "  Clients: ${CLIENT_COUNT}"
fi
