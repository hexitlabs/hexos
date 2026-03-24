#!/usr/bin/env bash
set -euo pipefail

# HexOS Phase 2 — Quick-add endpoint to client egress policy
# Usage: egress-allow.sh <client> <host:port>

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

export PATH="/usr/sbin:/sbin:${PATH}"

usage() {
    echo "Usage: egress-allow.sh <client> <host[:port]>"
    echo ""
    echo "Quick-add an endpoint to the client's egress allowlist."
    echo "Adds to egress.yaml and immediately applies."
    echo ""
    echo "Examples:"
    echo "  egress-allow.sh jirka api.newservice.com:443"
    echo "  egress-allow.sh jirka api.newservice.com"
    exit 1
}

[[ $# -lt 2 ]] && usage

CLIENT="$1"
ENDPOINT="$2"

if [[ ! "$CLIENT" =~ ^[a-z][a-z0-9-]{1,30}[a-z0-9]$ ]]; then
    echo "Error: Invalid client name '${CLIENT}'"
    exit 1
fi

# Parse host:port
if [[ "$ENDPOINT" == *:* ]]; then
    HOST="${ENDPOINT%%:*}"
    PORT="${ENDPOINT##*:}"
else
    HOST="$ENDPOINT"
    PORT="443"
fi

# Validate host (basic check)
if [[ -z "$HOST" || "$HOST" =~ [[:space:]] ]]; then
    echo "Error: Invalid hostname '${HOST}'"
    exit 1
fi

# Validate port
if [[ ! "$PORT" =~ ^[0-9]+$ ]] || [[ "$PORT" -lt 1 || "$PORT" -gt 65535 ]]; then
    echo "Error: Invalid port '${PORT}'"
    exit 1
fi

CLIENT_HOME="/hexos/${CLIENT}"
CONFIG_FILE="${CLIENT_HOME}/config/egress.yaml"

if [[ ! -f "$CONFIG_FILE" ]]; then
    echo "Error: No egress config at ${CONFIG_FILE}"
    exit 1
fi

echo "Adding endpoint: ${HOST}:${PORT} → ${CLIENT}"

# Add to custom rules using yq
yq -i ".egress.custom += [{\"host\": \"${HOST}\", \"port\": ${PORT}, \"protocol\": \"tcp\", \"comment\": \"Quick-added $(date -Iseconds)\"}]" "$CONFIG_FILE"

echo "✓ Added to ${CONFIG_FILE}"

# Re-apply rules
"${SCRIPT_DIR}/egress-apply.sh" "$CLIENT"

echo ""
echo "✓ Endpoint ${HOST}:${PORT} is now allowed for ${CLIENT}"
