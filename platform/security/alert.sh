#!/usr/bin/env bash
# HexOS Phase 1.5 — Security Alert System
# Foundation for security event notifications
# Current: writes to log file. Phase 6: Telegram, email, webhook
#
# Usage: alert.sh <severity> <client> <scan-type> <message>
set -uo pipefail

SEVERITY="${1:-INFO}"
CLIENT="${2:-unknown}"
SCAN_TYPE="${3:-unknown}"
MESSAGE="${4:-No message provided}"

ALERT_LOG="/hexos/platform/security/alerts.log"
mkdir -p "$(dirname "$ALERT_LOG")" 2>/dev/null || ALERT_LOG="/tmp/hexos-security-alerts.log"

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
ALERT_LINE="[${TIMESTAMP}] [${CLIENT}] [${SEVERITY}] [${SCAN_TYPE}] ${MESSAGE}"

# Write to log
echo "$ALERT_LINE" >> "$ALERT_LOG"

# Deduplication: suppress identical alerts within 5 minutes
DEDUP_KEY=$(echo "${CLIENT}|${SEVERITY}|${SCAN_TYPE}|${MESSAGE}" | md5sum | awk '{print $1}')
DEDUP_FILE="/tmp/hexos-alert-dedup-${DEDUP_KEY}"
if [[ -f "$DEDUP_FILE" ]]; then
    LAST=$(cat "$DEDUP_FILE" 2>/dev/null || echo "0")
    NOW=$(date +%s)
    [[ $((NOW - LAST)) -lt 300 ]] && exit 0
fi
date +%s > "$DEDUP_FILE"

# Console notification
case "$SEVERITY" in
    CRITICAL) echo "🚨 [HexOS Security] ${ALERT_LINE}" >&2 ;;
    WARNING)  echo "⚠️  [HexOS Security] ${ALERT_LINE}" >&2 ;;
    INFO)     echo "ℹ️  [HexOS Security] ${ALERT_LINE}" >&2 ;;
esac

# Webhook (if configured)
WEBHOOK_URL="${HEXOS_ALERT_WEBHOOK:-}"
if [[ -n "$WEBHOOK_URL" ]]; then
    curl -s -X POST "$WEBHOOK_URL" \
        -H "Content-Type: application/json" \
        -d "{\"timestamp\":\"${TIMESTAMP}\",\"client\":\"${CLIENT}\",\"severity\":\"${SEVERITY}\",\"scan_type\":\"${SCAN_TYPE}\",\"message\":\"$(echo "$MESSAGE" | sed 's/"/\\"/g')\"}" \
        >/dev/null 2>&1 || true
fi

# TODO Phase 6: Telegram bot notification
# TODO Phase 6: Email notification

exit 0
