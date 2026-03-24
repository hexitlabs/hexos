#!/usr/bin/env bash
# HexOS Phase 6 — Approval System
# CLI-based approval for risky agent actions
# Future: Telegram inline button integration via gateway message plugin
#
# Usage:
#   source approve.sh
#   request_approval <client> <agent> <action_type> <description> [risk_level] [timeout_sec]
#   resolve_approval <request_id> approve|reject [reason]
#   list_pending [client]
set -uo pipefail

AUDIT_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HEXOS_BASE="${HEXOS_BASE:-/hexos}"
APPROVAL_DIR="${HEXOS_BASE}/platform/audit/pending"
APPROVAL_LOG="${HEXOS_BASE}/platform/audit/approvals.log"

# Source logger
# shellcheck source=logger.sh
[[ -f "${AUDIT_SCRIPT_DIR}/logger.sh" ]] && source "${AUDIT_SCRIPT_DIR}/logger.sh"

# Ensure directories
mkdir -p "$APPROVAL_DIR" 2>/dev/null || {
    APPROVAL_DIR="/tmp/hexos-audit/pending"
    APPROVAL_LOG="/tmp/hexos-audit/approvals.log"
    mkdir -p "$APPROVAL_DIR"
}

# ── Risky Action Definitions ─────────────────────────────────────────
# Actions that require approval before execution
RISKY_ACTIONS=(
    "external_messaging"     # Sending emails, messages to external services
    "file_deletion"          # Deleting files outside workspace
    "system_change"          # System configuration changes
    "new_api_endpoint"       # Contacting a new external API
    "privilege_escalation"   # Requesting elevated permissions
    "data_export"            # Exporting data outside the platform
    "config_change"          # Modifying security or egress config
    "skill_install"          # Installing new skills
)

# Check if an action type is risky
is_risky_action() {
    local action_type="$1"
    for risky in "${RISKY_ACTIONS[@]}"; do
        [[ "$action_type" == "$risky" ]] && return 0
    done
    return 1
}

# ── Request Approval ─────────────────────────────────────────────────
# Creates approval request file and logs it
# Returns: request ID
request_approval() {
    local client="${1:?Client required}"
    local agent="${2:?Agent required}"
    local action_type="${3:?Action type required}"
    local description="${4:?Description required}"
    local risk_level="${5:-medium}"
    local timeout_sec="${6:-300}"

    local request_id
    request_id="apr_$(head -c 6 /dev/urandom | xxd -p)"
    local ts
    ts="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    local timeout_at
    timeout_at="$(date -u -d "+${timeout_sec} seconds" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || \
                  date -u -v+${timeout_sec}S +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || \
                  echo "unknown")"

    # Create request file
    local request_file="${APPROVAL_DIR}/${request_id}.json"
    cat > "$request_file" <<EOF
{
    "id": "${request_id}",
    "client": "${client}",
    "agent": "${agent}",
    "action_type": "${action_type}",
    "description": "${description}",
    "risk_level": "${risk_level}",
    "requested_at": "${ts}",
    "timeout_at": "${timeout_at}",
    "timeout_sec": ${timeout_sec},
    "status": "pending"
}
EOF

    # Log the request
    if declare -f audit_log &>/dev/null; then
        audit_log "$client" "approval" "$agent" \
            "request_id=${request_id}" \
            "action_type=${action_type}" \
            "description=${description}" \
            "risk_level=${risk_level}" \
            "status=pending"
    fi

    # Append to approval log
    echo "[${ts}] PENDING ${request_id} client=${client} agent=${agent} action=${action_type} risk=${risk_level} desc=\"${description}\"" >> "$APPROVAL_LOG"

    # Print notification for operator
    echo ""
    echo "⚠️  APPROVAL REQUIRED"
    echo "  Request:     ${request_id}"
    echo "  Client:      ${client}"
    echo "  Agent:       ${agent}"
    echo "  Action:      ${action_type}"
    echo "  Risk Level:  ${risk_level}"
    echo "  Description: ${description}"
    echo "  Timeout:     ${timeout_sec}s (${timeout_at})"
    echo ""
    echo "  To approve:  hexos audit approve ${request_id}"
    echo "  To reject:   hexos audit reject ${request_id}"
    echo ""

    # Return request ID
    echo "$request_id"

    # ── Telegram Integration Point ───────────────────────────────
    # When the gateway message plugin supports inline buttons:
    #
    # message_tool send \
    #   --target "$OPERATOR_CHAT_ID" \
    #   --message "⚠️ *Approval Required*\n\nClient: ${client}\nAgent: ${agent}\nAction: ${action_type}\nRisk: ${risk_level}\n\n${description}" \
    #   --inline-buttons '[
    #     [{"text": "✅ Approve", "callback_data": "audit_approve_'${request_id}'"}],
    #     [{"text": "❌ Reject",  "callback_data": "audit_reject_'${request_id}'"}]
    #   ]'
    #
    # The callback handler would call: resolve_approval $request_id approve|reject
    # ─────────────────────────────────────────────────────────────
}

# ── Resolve Approval ─────────────────────────────────────────────────
# Approve or reject a pending request
resolve_approval() {
    local request_id="${1:?Request ID required}"
    local decision="${2:?Decision required (approve|reject)}"
    local reason="${3:-}"

    local request_file="${APPROVAL_DIR}/${request_id}.json"

    if [[ ! -f "$request_file" ]]; then
        echo "Error: Request ${request_id} not found"
        return 1
    fi

    # Read request details
    local client agent action_type status
    client=$(grep -oP '"client":\s*"[^"]*"' "$request_file" | cut -d'"' -f4)
    agent=$(grep -oP '"agent":\s*"[^"]*"' "$request_file" | cut -d'"' -f4)
    action_type=$(grep -oP '"action_type":\s*"[^"]*"' "$request_file" | cut -d'"' -f4)
    status=$(grep -oP '"status":\s*"[^"]*"' "$request_file" | cut -d'"' -f4)

    if [[ "$status" != "pending" ]]; then
        echo "Error: Request ${request_id} already resolved (status: ${status})"
        return 1
    fi

    local ts
    ts="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    local new_status

    case "$decision" in
        approve|approved)
            new_status="approved"
            ;;
        reject|rejected)
            new_status="rejected"
            ;;
        *)
            echo "Error: Invalid decision. Use 'approve' or 'reject'"
            return 1
            ;;
    esac

    # Update request file
    local resolved_file="${APPROVAL_DIR}/${request_id}.resolved.json"
    cat > "$resolved_file" <<EOF
{
    "id": "${request_id}",
    "client": "${client}",
    "agent": "${agent}",
    "action_type": "${action_type}",
    "status": "${new_status}",
    "decided_at": "${ts}",
    "decided_by": "${USER:-operator}",
    "reason": "${reason}"
}
EOF

    # Remove pending file
    rm -f "$request_file"

    # Log the decision
    if declare -f audit_log &>/dev/null; then
        audit_log "$client" "approval" "system" \
            "request_id=${request_id}" \
            "action_type=${action_type}" \
            "decision=${new_status}" \
            "decided_by=${USER:-operator}" \
            "reason=${reason}"
    fi

    echo "[${ts}] ${new_status^^} ${request_id} by=${USER:-operator} reason=\"${reason}\"" >> "$APPROVAL_LOG"

    echo "✓ Request ${request_id} ${new_status}"
    return 0
}

# ── List Pending Approvals ───────────────────────────────────────────
list_pending() {
    local client_filter="${1:-}"
    local count=0

    echo "╔══════════════════════════════════════════════════╗"
    echo "║  Pending Approval Requests                        ║"
    echo "╚══════════════════════════════════════════════════╝"
    echo ""

    for f in "${APPROVAL_DIR}"/*.json; do
        [[ -f "$f" ]] || continue
        [[ "$f" == *.resolved.json ]] && continue

        local req_id client agent action risk ts
        req_id=$(grep -oP '"id":\s*"[^"]*"' "$f" | cut -d'"' -f4)
        client=$(grep -oP '"client":\s*"[^"]*"' "$f" | cut -d'"' -f4)
        agent=$(grep -oP '"agent":\s*"[^"]*"' "$f" | cut -d'"' -f4)
        action=$(grep -oP '"action_type":\s*"[^"]*"' "$f" | cut -d'"' -f4)
        risk=$(grep -oP '"risk_level":\s*"[^"]*"' "$f" | cut -d'"' -f4)
        ts=$(grep -oP '"requested_at":\s*"[^"]*"' "$f" | cut -d'"' -f4)

        # Apply client filter
        if [[ -n "$client_filter" ]] && [[ "$client" != "$client_filter" ]]; then
            continue
        fi

        echo "  ID:      ${req_id}"
        echo "  Client:  ${client}"
        echo "  Agent:   ${agent}"
        echo "  Action:  ${action}"
        echo "  Risk:    ${risk}"
        echo "  Time:    ${ts}"
        echo "  ─────────────────────────"
        count=$((count + 1))
    done

    if [[ $count -eq 0 ]]; then
        echo "  No pending approvals."
    else
        echo ""
        echo "  Total: ${count} pending"
    fi
    echo ""
}

# ── Timeout Checker ──────────────────────────────────────────────────
# Check and auto-reject timed-out requests
check_timeouts() {
    local now_epoch
    now_epoch=$(date +%s)

    for f in "${APPROVAL_DIR}"/*.json; do
        [[ -f "$f" ]] || continue
        [[ "$f" == *.resolved.json ]] && continue

        local timeout_sec req_id requested_at
        req_id=$(grep -oP '"id":\s*"[^"]*"' "$f" | cut -d'"' -f4)
        requested_at=$(grep -oP '"requested_at":\s*"[^"]*"' "$f" | cut -d'"' -f4)
        timeout_sec=$(grep -oP '"timeout_sec":\s*[0-9]*' "$f" | grep -oP '[0-9]+')

        # Calculate if timed out
        local request_epoch
        request_epoch=$(date -d "$requested_at" +%s 2>/dev/null || echo "0")
        if [[ $request_epoch -gt 0 ]]; then
            local deadline=$((request_epoch + timeout_sec))
            if [[ $now_epoch -gt $deadline ]]; then
                echo "⏰ Auto-rejecting timed-out request: ${req_id}"
                resolve_approval "$req_id" "reject" "Auto-rejected: timeout"
            fi
        fi
    done
}

# ── Wait for Approval ────────────────────────────────────────────────
# Blocks until approval is resolved or times out
# Returns 0 if approved, 1 if rejected/timeout
wait_for_approval() {
    local request_id="${1:?Request ID required}"
    local timeout_sec="${2:-300}"
    local poll_interval="${3:-2}"

    local elapsed=0
    while [[ $elapsed -lt $timeout_sec ]]; do
        local resolved_file="${APPROVAL_DIR}/${request_id}.resolved.json"
        if [[ -f "$resolved_file" ]]; then
            local status
            status=$(grep -oP '"status":\s*"[^"]*"' "$resolved_file" | cut -d'"' -f4)
            if [[ "$status" == "approved" ]]; then
                return 0
            else
                return 1
            fi
        fi
        sleep "$poll_interval"
        elapsed=$((elapsed + poll_interval))
    done

    # Timed out — auto-reject
    resolve_approval "$request_id" "reject" "Auto-rejected: timeout after ${timeout_sec}s"
    return 1
}

# ── CLI Entry Point ──────────────────────────────────────────────────
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    case "${1:-help}" in
        approve)
            resolve_approval "${2:?Request ID required}" "approve" "${3:-}"
            ;;
        reject)
            resolve_approval "${2:?Request ID required}" "reject" "${3:-}"
            ;;
        pending|list)
            list_pending "${2:-}"
            ;;
        check-timeouts)
            check_timeouts
            ;;
        *)
            echo "Usage: approve.sh {approve|reject|pending|check-timeouts} [args]"
            echo ""
            echo "  approve <request-id> [reason]   Approve a pending request"
            echo "  reject <request-id> [reason]    Reject a pending request"
            echo "  pending [client]                List pending approvals"
            echo "  check-timeouts                  Auto-reject timed-out requests"
            ;;
    esac
fi
