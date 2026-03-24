#!/usr/bin/env bash
set -euo pipefail

# HexOS Phase 2 — Show egress status for a client
# Usage: egress-status.sh <client>

export PATH="/usr/sbin:/sbin:${PATH}"

[[ $# -lt 1 ]] && { echo "Usage: egress-status.sh <client>"; exit 1; }

CLIENT="$1"

if [[ ! "$CLIENT" =~ ^[a-z][a-z0-9-]{1,30}[a-z0-9]$ ]]; then
    echo "Error: Invalid client name '${CLIENT}'"
    exit 1
fi

TABLE_NAME="hexos_${CLIENT//-/_}"
CLIENT_HOME="/hexos/${CLIENT}"
CONFIG_FILE="${CLIENT_HOME}/config/egress.yaml"

echo "═══════════════════════════════════════════════════"
echo "  Egress Status: ${CLIENT}"
echo "═══════════════════════════════════════════════════"
echo ""

# ── LOCKDOWN check ───────────────────────────────────────────────────────
if [[ -f "${CLIENT_HOME}/config/.egress-lockdown" ]]; then
    echo "  🚨 STATUS: LOCKDOWN"
    echo "  All outbound traffic is BLOCKED"
    lockdown_time=$(cat "${CLIENT_HOME}/config/.egress-lockdown" 2>/dev/null || echo "unknown")
    echo "  Lockdown since: ${lockdown_time}"
    echo ""
fi

# ── Policy summary ───────────────────────────────────────────────────────
echo "── Policy ─────────────────────────────────────────"
if [[ -f "$CONFIG_FILE" ]]; then
    echo "  Config: ${CONFIG_FILE}"
    PRESETS=$(yq -r '.egress.presets[]? // empty' "$CONFIG_FILE" 2>/dev/null || true)
    if [[ -n "$PRESETS" ]]; then
        echo "  Presets: ${PRESETS}"
    else
        echo "  Presets: (none)"
    fi

    CUSTOM_COUNT=$(yq -r '.egress.custom | length // 0' "$CONFIG_FILE" 2>/dev/null || echo "0")
    echo "  Custom rules: ${CUSTOM_COUNT}"

    DNS_RESOLVER=$(yq -r '.egress.dns.resolver // "127.0.0.53"' "$CONFIG_FILE" 2>/dev/null || echo "127.0.0.53")
    echo "  DNS resolver: ${DNS_RESOLVER}"

    if [[ -f "${CLIENT_HOME}/config/.egress-applied" ]]; then
        echo "  Last applied: $(cat "${CLIENT_HOME}/config/.egress-applied")"
    else
        echo "  Last applied: never"
    fi
else
    echo "  Config: NOT FOUND (${CONFIG_FILE})"
    echo "  No egress policy configured"
fi
echo ""

# ── Active nftables rules ────────────────────────────────────────────────
echo "── Active Rules ───────────────────────────────────"
if nft list table inet "${TABLE_NAME}" &>/dev/null; then
    RULE_COUNT=$(nft list table inet "${TABLE_NAME}" 2>/dev/null | wc -l)
    echo "  Table: inet ${TABLE_NAME} (${RULE_COUNT} lines)"

    # Show set contents
    SET_NAME="${CLIENT//-/_}_allowed_v4"
    if nft list set inet "${TABLE_NAME}" "${SET_NAME}" &>/dev/null; then
        IP_COUNT=$(nft list set inet "${TABLE_NAME}" "${SET_NAME}" 2>/dev/null | grep "elements" | tr ',' '\n' | wc -l)
        echo "  IP set: ${SET_NAME} (${IP_COUNT} entries)"
    fi

    # Show counters
    nft list table inet "${TABLE_NAME}" 2>/dev/null | grep "counter" | while read -r line; do
        echo "  Counter: ${line}"
    done
else
    echo "  No active nftables rules"
fi
echo ""

# ── Recent violations ────────────────────────────────────────────────────
echo "── Recent Violations (last 10) ─────────────────────"
DENY_PREFIX="hexos-egress-${CLIENT}-DENY"

# Check journald
if command -v journalctl &>/dev/null; then
    violations=$(journalctl -k --since "1 hour ago" --no-pager 2>/dev/null | grep "${DENY_PREFIX}" | tail -10 || true)
    if [[ -n "$violations" ]]; then
        echo "$violations" | while IFS= read -r line; do
            echo "  ${line}"
        done
    else
        echo "  No violations in the last hour"
    fi
else
    # Fallback: check syslog
    if [[ -f /var/log/syslog ]]; then
        violations=$(grep "${DENY_PREFIX}" /var/log/syslog 2>/dev/null | tail -10 || true)
        if [[ -n "$violations" ]]; then
            echo "$violations" | while IFS= read -r line; do
                echo "  ${line}"
            done
        else
            echo "  No violations found in syslog"
        fi
    else
        echo "  Cannot check violations (no journald or syslog)"
    fi
fi
echo ""

# ── Violation statistics ─────────────────────────────────────────────────
echo "── Violation Stats (last 24h) ────────────────────"
if command -v journalctl &>/dev/null; then
    total=$(journalctl -k --since "24 hours ago" --no-pager 2>/dev/null | grep -c "${DENY_PREFIX}" || echo "0")
    echo "  Total blocked connections: ${total}"

    if [[ "$total" -gt 0 ]]; then
        echo "  Top blocked destinations:"
        journalctl -k --since "24 hours ago" --no-pager 2>/dev/null | grep "${DENY_PREFIX}" | \
            grep -oP 'DST=\K[0-9.]+' | sort | uniq -c | sort -rn | head -5 | \
            while read -r count ip; do
                # Try reverse DNS
                hostname=$(dig +short -x "$ip" 2>/dev/null | head -1 || echo "")
                if [[ -n "$hostname" ]]; then
                    echo "    ${count}x  ${ip} (${hostname})"
                else
                    echo "    ${count}x  ${ip}"
                fi
            done
    fi
else
    echo "  (journalctl not available)"
fi
echo ""
echo "═══════════════════════════════════════════════════"
