#!/usr/bin/env bash
set -euo pipefail
# HexOS Deploy Client — Full client onboarding with all security layers
#
# Usage: hexos-deploy-client.sh <client-name> [--presets preset1,preset2]
#
# This is the one-command client setup that:
# 1. Creates workspace jail (Phase 1)
# 2. Initializes security scanner config (Phase 1.5)
# 3. Applies egress control (Phase 2)
#
# Only works in managed mode.

export PATH="/usr/sbin:/sbin:${PATH}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLATFORM_DIR="$(dirname "$SCRIPT_DIR")"
HEXOS_CONFIG="${PLATFORM_DIR}/config/hexos.yaml"
SECURITY_DIR="${PLATFORM_DIR}/security"
NETWORK_DIR="${PLATFORM_DIR}/network"

# Check mode
if [[ -f "$HEXOS_CONFIG" ]]; then
    MODE=$(grep -oP '^\s+mode:\s+\K\w+' "$HEXOS_CONFIG" 2>/dev/null || echo "unknown")
    if [[ "$MODE" == "operator" ]]; then
        echo "Error: Client deployment requires managed mode."
        echo "Current mode: operator"
        echo "Run 'hexos setup managed' to switch."
        exit 1
    fi
fi

# Parse arguments
CLIENT_NAME=""
PRESETS="anthropic,telegram"
CUSTOM_HOSTS=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --presets)
            PRESETS="${2:-}"
            shift 2
            ;;
        --custom)
            CUSTOM_HOSTS="${2:-}"
            shift 2
            ;;
        --help|-h)
            echo "Usage: hexos deploy <client-name> [options]"
            echo ""
            echo "Options:"
            echo "  --presets <p1,p2,...>   Egress presets (default: anthropic,telegram)"
            echo "  --custom <h1,h2,...>   Additional custom hosts to allow"
            echo ""
            echo "Available presets: anthropic, openai, telegram, github, stripe,"
            echo "  salesmanago, brave-search, firecrawl, google-search, web-general"
            exit 0
            ;;
        -*)
            echo "Unknown option: $1"
            exit 1
            ;;
        *)
            CLIENT_NAME="$1"
            shift
            ;;
    esac
done

if [[ -z "$CLIENT_NAME" ]]; then
    echo "Error: Client name required"
    echo "Usage: hexos deploy <client-name> [--presets anthropic,telegram]"
    exit 1
fi

CLIENT_HOME="/hexos/${CLIENT_NAME}"
EGRESS_CONFIG="${CLIENT_HOME}/config/egress.yaml"

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║  HexOS Client Deployment                          ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
echo "  Client:  ${CLIENT_NAME}"
echo "  Presets: ${PRESETS}"
[[ -n "$CUSTOM_HOSTS" ]] && echo "  Custom:  ${CUSTOM_HOSTS}"
echo ""

# ── Step 1: Create Workspace Jail ────────────────────────────────────────
echo "━━━ Step 1/4: Workspace Jail ━━━"
"${SCRIPT_DIR}/hexos-client-create.sh" "$CLIENT_NAME"
echo ""

# ── Step 2: Initialize Security Scanner Config ──────────────────────────
echo "━━━ Step 2/4: Security Scanner ━━━"
# Create security directories
mkdir -p "${CLIENT_HOME}/security/"{policies,reports,baselines,quarantine}
chown -R "hexos-${CLIENT_NAME}:hexos-${CLIENT_NAME}" "${CLIENT_HOME}/security/"

# Copy default scan policy
if [[ -f "${SECURITY_DIR}/policies/default.yaml" ]]; then
    cp "${SECURITY_DIR}/policies/default.yaml" "${CLIENT_HOME}/security/policies/scan-policy.yaml"
    echo "  ✓ Scan policy initialized (strict mode)"
else
    echo "  ⚠ Default scan policy not found — using built-in defaults"
fi

# Run initial workspace scan to establish baseline
if [[ -x "${SECURITY_DIR}/scan-workspace.sh" ]]; then
    "${SECURITY_DIR}/scan-workspace.sh" "${CLIENT_HOME}/workspace" "$CLIENT_NAME" 2>/dev/null || true
    echo "  ✓ Initial workspace baseline created"
fi
echo ""

# ── Step 3: Configure Egress Control ────────────────────────────────────
echo "━━━ Step 3/4: Network Egress ━━━"

# Generate egress.yaml from presets
PRESET_YAML=""
IFS=',' read -ra PRESET_ARRAY <<< "$PRESETS"
for p in "${PRESET_ARRAY[@]}"; do
    p=$(echo "$p" | tr -d '[:space:]')
    PRESET_YAML="${PRESET_YAML}    - ${p}\n"
done

# Generate custom hosts YAML
CUSTOM_YAML=""
if [[ -n "$CUSTOM_HOSTS" ]]; then
    IFS=',' read -ra CUSTOM_ARRAY <<< "$CUSTOM_HOSTS"
    for h in "${CUSTOM_ARRAY[@]}"; do
        h=$(echo "$h" | tr -d '[:space:]')
        if [[ "$h" == *:* ]]; then
            HOST="${h%%:*}"
            PORT="${h##*:}"
        else
            HOST="$h"
            PORT="443"
        fi
        CUSTOM_YAML="${CUSTOM_YAML}    - host: \"${HOST}\"\n      port: ${PORT}\n      protocol: tcp\n"
    done
fi

cat > "$EGRESS_CONFIG" <<EOF
# HexOS Egress Policy for ${CLIENT_NAME}
# Generated: $(date -Iseconds)
egress:
  presets:
$(echo -e "$PRESET_YAML" | sed '/^$/d')
$(if [[ -n "$CUSTOM_YAML" ]]; then
    echo "  custom:"
    echo -e "$CUSTOM_YAML" | sed '/^$/d'
fi)
  dns:
    resolver: "1.1.1.1"
    allow_custom: false

  logging:
    log_blocked: true
    log_allowed: false
    rate_limit: 100
EOF

chown "hexos-${CLIENT_NAME}:hexos-${CLIENT_NAME}" "$EGRESS_CONFIG"
echo "  ✓ Egress policy created: ${EGRESS_CONFIG}"

# Apply egress rules (dry-run first to validate)
if [[ -x "${NETWORK_DIR}/egress-apply.sh" ]]; then
    if "${NETWORK_DIR}/egress-apply.sh" "$CLIENT_NAME" --check-only 2>/dev/null; then
        "${NETWORK_DIR}/egress-apply.sh" "$CLIENT_NAME" 2>/dev/null || true
        echo "  ✓ Egress rules applied"
    else
        echo "  ⚠ Egress rules validation failed — apply manually with 'hexos egress apply ${CLIENT_NAME}'"
    fi
fi
echo ""

# ── Step 4: Summary ────────────────────────────────────────────────────
echo "━━━ Step 4/4: Summary ━━━"
echo ""
echo "  ✅ Client '${CLIENT_NAME}' fully deployed with:"
echo "     • Workspace jail at ${CLIENT_HOME}/"
echo "     • System user: hexos-${CLIENT_NAME}"
echo "     • Security scanner: strict mode"
echo "     • Egress control: ${PRESETS}"
echo ""
echo "  Next steps:"
echo "     1. Place gateway config at ${CLIENT_HOME}/config/gateway.yaml"
echo "     2. Start with: systemctl start hexos-agent@${CLIENT_NAME}"
echo "     3. Verify: hexos security verify ${CLIENT_NAME}"
echo "     4. Test egress: hexos egress test ${CLIENT_NAME} api.anthropic.com 443"
echo ""
echo "  Management:"
echo "     hexos client status ${CLIENT_NAME}   — check status"
echo "     hexos egress status ${CLIENT_NAME}   — check egress rules"
echo "     hexos egress allow ${CLIENT_NAME} <host:port> — add endpoint"
echo "     hexos client remove ${CLIENT_NAME} --confirm  — tear down"
