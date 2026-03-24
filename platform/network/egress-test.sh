#!/usr/bin/env bash
set -euo pipefail

# HexOS Phase 2 — Test if an endpoint is reachable from a client's context
# Usage: egress-test.sh <client> <host> <port>

export PATH="/usr/sbin:/sbin:${PATH}"

usage() {
    echo "Usage: egress-test.sh <client> <host> [port]"
    echo ""
    echo "Test if an endpoint is reachable under the client's egress policy."
    echo ""
    echo "Examples:"
    echo "  egress-test.sh jirka api.anthropic.com 443"
    echo "  egress-test.sh jirka api.openai.com"
    exit 1
}

[[ $# -lt 2 ]] && usage

CLIENT="$1"
HOST="$2"
PORT="${3:-443}"

if [[ ! "$CLIENT" =~ ^[a-z][a-z0-9-]{1,30}[a-z0-9]$ ]]; then
    echo "Error: Invalid client name '${CLIENT}'"
    exit 1
fi

CLIENT_USER="hexos-${CLIENT}"
CLIENT_HOME="/hexos/${CLIENT}"
CONFIG_FILE="${CLIENT_HOME}/config/egress.yaml"
TABLE_NAME="hexos_${CLIENT//-/_}"
SET_NAME="${CLIENT//-/_}_allowed_v4"

echo "Testing egress: ${CLIENT} → ${HOST}:${PORT}"
echo ""

# ── Step 1: DNS Resolution ───────────────────────────────────────────────
echo "1. DNS Resolution"
RESOLVED_IPS=$(dig +short A "$HOST" 2>/dev/null | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' || true)
if [[ -z "$RESOLVED_IPS" ]]; then
    echo "   ✗ DNS resolution failed for ${HOST}"
    echo "   Check: Is the hostname correct? Is DNS working?"
    exit 1
fi
echo "   ✓ Resolved to: $(echo $RESOLVED_IPS | tr '\n' ' ')"
echo ""

# ── Step 2: Check if in allowlist ────────────────────────────────────────
echo "2. Allowlist Check"
if [[ -f "$CONFIG_FILE" ]]; then
    # Check presets
    is_allowed=false
    PRESETS=$(yq -r '.egress.presets[]? // empty' "$CONFIG_FILE" 2>/dev/null || true)
    for preset in $PRESETS; do
        preset_file="/hexos/platform/config/egress-presets/${preset}.yaml"
        [[ -f "$preset_file" ]] || continue

        # Check unrestricted
        if yq -r '.unrestricted_ports[]? // empty' "$preset_file" 2>/dev/null | grep -qw "$PORT"; then
            echo "   ✓ Port ${PORT} allowed by preset '${preset}' (unrestricted)"
            is_allowed=true
            break
        fi

        # Check specific hosts
        while IFS= read -r allowed_host; do
            # Exact match
            if [[ "$allowed_host" == "$HOST" ]]; then
                echo "   ✓ Host ${HOST} allowed by preset '${preset}'"
                is_allowed=true
                break 2
            fi
            # Wildcard match (*.example.com matches sub.example.com)
            if [[ "${allowed_host:0:2}" == "*." ]]; then
                base="${allowed_host:2}"
                if [[ "$HOST" == *".$base" || "$HOST" == "$base" ]]; then
                    echo "   ✓ Host ${HOST} matches wildcard ${allowed_host} in preset '${preset}'"
                    is_allowed=true
                    break 2
                fi
            fi
        done < <(yq -r '.allow[]?.host // empty' "$preset_file")
    done

    if [[ "$is_allowed" == "false" ]]; then
        # Check custom rules
        while IFS= read -r custom_host; do
            if [[ "$custom_host" == "$HOST" ]]; then
                echo "   ✓ Host ${HOST} allowed by custom rule"
                is_allowed=true
                break
            fi
            if [[ "${custom_host:0:2}" == "*." ]]; then
                base="${custom_host:2}"
                if [[ "$HOST" == *".$base" || "$HOST" == "$base" ]]; then
                    echo "   ✓ Host ${HOST} matches wildcard ${custom_host} in custom rules"
                    is_allowed=true
                    break
                fi
            fi
        done < <(yq -r '.egress.custom[]?.host // empty' "$CONFIG_FILE" 2>/dev/null || true)
    fi

    if [[ "$is_allowed" == "false" ]]; then
        echo "   ✗ Host ${HOST}:${PORT} is NOT in the allowlist"
        echo "   To add: hexos egress allow ${CLIENT} ${HOST}:${PORT}"
    fi
else
    echo "   ✗ No egress config found — all traffic blocked by default"
fi
echo ""

# ── Step 3: nftables set check ───────────────────────────────────────────
echo "3. nftables Set Check"
if nft list set inet "${TABLE_NAME}" "${SET_NAME}" &>/dev/null; then
    set_contents=$(nft list set inet "${TABLE_NAME}" "${SET_NAME}" 2>/dev/null)
    found_in_set=false
    for ip in $RESOLVED_IPS; do
        if echo "$set_contents" | grep -q "$ip"; then
            echo "   ✓ IP ${ip} found in nftables set"
            found_in_set=true
        else
            echo "   ✗ IP ${ip} NOT in nftables set"
        fi
    done
else
    echo "   No nftables set found (rules may not be applied)"
fi
echo ""

# ── Step 4: Connection test ──────────────────────────────────────────────
echo "4. Connection Test (as ${CLIENT_USER})"
if id "$CLIENT_USER" &>/dev/null; then
    # Test TCP connection using the client's UID
    if timeout 5 sudo -u "$CLIENT_USER" bash -c "echo | timeout 3 openssl s_client -connect ${HOST}:${PORT} -brief 2>/dev/null | head -1" 2>/dev/null; then
        echo "   ✓ Connection successful"
    else
        # Try basic TCP
        if timeout 5 sudo -u "$CLIENT_USER" bash -c "echo > /dev/tcp/${HOST}/${PORT}" 2>/dev/null; then
            echo "   ✓ TCP connection successful"
        else
            echo "   ✗ Connection failed or blocked"
        fi
    fi
else
    echo "   ⚠ User ${CLIENT_USER} does not exist — cannot test as client"
    echo "   Testing from current user instead..."
    if timeout 3 bash -c "echo > /dev/tcp/${HOST}/${PORT}" 2>/dev/null; then
        echo "   ✓ TCP connection works (from current user, not client context)"
    else
        echo "   ✗ Connection failed even from current user"
    fi
fi
echo ""

echo "Test complete."
