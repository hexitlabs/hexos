#!/usr/bin/env bash
# HexOS Phase 6 — Audit Logger
# JSONL-based audit trail with daily rotation and hash chaining
#
# Usage:
#   source logger.sh
#   audit_log <client> <type> <agent> [key=value ...]
#
# Types: tool_call, api_call, system_event, security_event, approval
#
# Example:
#   audit_log jirka tool_call orchestrator tool=exec input="npm install" status=success duration_ms=1234
#   audit_log jirka api_call web-agent endpoint=https://api.example.com method=GET status=200 duration_ms=450
set -uo pipefail

AUDIT_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HEXOS_BASE="${HEXOS_BASE:-/hexos}"

# Source sanitizer
# shellcheck source=sanitize.sh
[[ -f "${AUDIT_SCRIPT_DIR}/sanitize.sh" ]] && source "${AUDIT_SCRIPT_DIR}/sanitize.sh"

# ── ID Generation ─────────────────────────────────────────────────────
_audit_generate_id() {
    # Fast event ID: evt_ + 12 hex chars
    printf "evt_%s" "$(head -c 6 /dev/urandom | xxd -p)"
}

_audit_generate_session_id() {
    # Session ID from env or generate
    echo "${HEXOS_SESSION_ID:-sess_$(head -c 4 /dev/urandom | xxd -p)}"
}

# ── Hash Chain ────────────────────────────────────────────────────────
_audit_get_prev_hash() {
    local log_file="$1"
    if [[ -f "$log_file" ]] && [[ -s "$log_file" ]]; then
        tail -1 "$log_file" | sha256sum | awk '{print $1}'
    else
        echo "genesis"
    fi
}

# ── Core Logging Function ────────────────────────────────────────────
# audit_log <client> <type> <agent> [key=value ...]
audit_log() {
    local client="${1:?Client required}"
    local event_type="${2:?Event type required}"
    local agent="${3:-system}"
    shift 3 || shift $#

    local ts
    ts="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    local today
    today="$(date -u +"%Y-%m-%d")"
    local event_id
    event_id="$(_audit_generate_id)"
    local session_id
    session_id="$(_audit_generate_session_id)"

    # Ensure audit directory exists
    local audit_dir="${HEXOS_BASE}/${client}/audit"
    mkdir -p "$audit_dir" 2>/dev/null || {
        # Fallback for testing
        audit_dir="/tmp/hexos-audit/${client}"
        mkdir -p "$audit_dir"
    }

    local log_file="${audit_dir}/${today}.jsonl"

    # Get previous hash for chaining
    local prev_hash
    prev_hash="$(_audit_get_prev_hash "$log_file")"

    # Build JSON from key=value pairs
    local extra_json=""
    local key val sanitized_val
    for arg in "$@"; do
        if [[ "$arg" == *=* ]]; then
            key="${arg%%=*}"
            val="${arg#*=}"
            # Sanitize value if sanitizer is available
            if declare -f sanitize_text &>/dev/null; then
                sanitized_val="$(sanitize_text "$val")"
            else
                sanitized_val="$val"
            fi
            # Escape quotes in value for JSON
            sanitized_val="${sanitized_val//\\/\\\\}"
            sanitized_val="${sanitized_val//\"/\\\"}"
            sanitized_val="${sanitized_val//$'\n'/\\n}"
            sanitized_val="${sanitized_val//$'\t'/\\t}"
            extra_json="${extra_json},\"${key}\":\"${sanitized_val}\""
        fi
    done

    # Build complete JSON entry
    local entry
    entry="{\"id\":\"${event_id}\",\"ts\":\"${ts}\",\"client\":\"${client}\",\"agent\":\"${agent}\",\"type\":\"${event_type}\",\"session\":\"${session_id}\",\"prev_hash\":\"${prev_hash}\"${extra_json}}"

    # Append atomically (single write)
    echo "$entry" >> "$log_file"

    # Return the event ID for correlation
    echo "$event_id"
}

# ── Convenience Wrappers ─────────────────────────────────────────────

# Log a tool invocation
# audit_log_tool <client> <agent> <tool> <input> <output> <status> <duration_ms>
audit_log_tool() {
    local client="$1" agent="$2" tool="$3" input="$4" output="$5" status="$6" duration_ms="$7"
    # Truncate output if too long
    if [[ ${#output} -gt 1000 ]]; then
        output="${output:0:997}..."
    fi
    audit_log "$client" "tool_call" "$agent" \
        "tool=${tool}" "input=${input}" "output=${output}" \
        "status=${status}" "duration_ms=${duration_ms}"
}

# Log an API call
# audit_log_api <client> <agent> <endpoint> <method> <status_code> <duration_ms>
audit_log_api() {
    local client="$1" agent="$2" endpoint="$3" method="$4" status_code="$5" duration_ms="$6"
    audit_log "$client" "api_call" "$agent" \
        "endpoint=${endpoint}" "method=${method}" \
        "status_code=${status_code}" "duration_ms=${duration_ms}"
}

# Log a system event
# audit_log_system <client> <agent> <event> <details>
audit_log_system() {
    local client="$1" agent="$2" event="$3" details="${4:-}"
    audit_log "$client" "system_event" "$agent" \
        "event=${event}" "details=${details}"
}

# Log a security event
# audit_log_security <client> <agent> <event> <severity> <details>
audit_log_security() {
    local client="$1" agent="$2" event="$3" severity="${4:-INFO}" details="${5:-}"
    audit_log "$client" "security_event" "$agent" \
        "event=${event}" "severity=${severity}" "details=${details}"
}

# ── Query Helpers ────────────────────────────────────────────────────

# Get today's log file path for a client
audit_log_path() {
    local client="${1:?Client required}"
    local date="${2:-$(date -u +"%Y-%m-%d")}"
    local audit_dir="${HEXOS_BASE}/${client}/audit"
    [[ ! -d "$audit_dir" ]] && audit_dir="/tmp/hexos-audit/${client}"
    echo "${audit_dir}/${date}.jsonl"
}

# Count events for a client on a given day
audit_count() {
    local client="${1:?Client required}"
    local date="${2:-$(date -u +"%Y-%m-%d")}"
    local log_file
    log_file="$(audit_log_path "$client" "$date")"
    if [[ -f "$log_file" ]]; then
        wc -l < "$log_file"
    else
        echo "0"
    fi
}

# Verify hash chain integrity
audit_verify_chain() {
    local client="${1:?Client required}"
    local date="${2:-$(date -u +"%Y-%m-%d")}"
    local log_file
    log_file="$(audit_log_path "$client" "$date")"

    if [[ ! -f "$log_file" ]]; then
        echo "No log file found for ${client} on ${date}"
        return 1
    fi

    local prev_hash="genesis"
    local line_num=0
    local current_hash entry_prev_hash

    while IFS= read -r line; do
        line_num=$((line_num + 1))

        # Extract prev_hash from entry
        entry_prev_hash=$(echo "$line" | grep -oP '"prev_hash":"[^"]*"' | cut -d'"' -f4)

        if [[ "$entry_prev_hash" != "$prev_hash" ]]; then
            echo "CHAIN BREAK at line ${line_num}: expected prev_hash=${prev_hash}, got ${entry_prev_hash}"
            return 1
        fi

        # Calculate hash of this line for next iteration
        prev_hash=$(echo "$line" | sha256sum | awk '{print $1}')
    done < "$log_file"

    echo "CHAIN VALID: ${line_num} entries verified"
    return 0
}
