#!/usr/bin/env bash
# HexOS Phase 6 — Audit Alert Rules
# Anomaly detection on audit logs
#
# Usage:
#   alerts.sh check <client>       Run all alert checks for a client
#   alerts.sh check-all            Run checks for all clients
#
# Alert rules:
#   1. API call spike (>100 calls/minute from one agent)
#   2. New external endpoint not in egress allowlist
#   3. Repeated failures (>10 consecutive errors)
#   4. Approval timeout (risky action auto-rejected)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HEXOS_BASE="${HEXOS_BASE:-/hexos}"
PLATFORM_DIR="${HEXOS_BASE}/platform"
SECURITY_ALERT="${PLATFORM_DIR}/security/alert.sh"

# Source logger for recording alert events
# shellcheck source=logger.sh
[[ -f "${SCRIPT_DIR}/logger.sh" ]] && source "${SCRIPT_DIR}/logger.sh"

# ── Alert Helper ─────────────────────────────────────────────────────
fire_alert() {
    local severity="$1"
    local client="$2"
    local rule="$3"
    local message="$4"

    # Use existing security alert system
    if [[ -x "$SECURITY_ALERT" ]]; then
        "$SECURITY_ALERT" "$severity" "$client" "audit_alert" "$message"
    else
        echo "[${severity}] [${client}] [${rule}] ${message}" >&2
    fi

    # Also log to audit trail
    if declare -f audit_log &>/dev/null; then
        audit_log "$client" "security_event" "alert_system" \
            "event=alert_fired" "rule=${rule}" "severity=${severity}" \
            "details=${message}"
    fi
}

# ── Rule 1: API Call Spike ───────────────────────────────────────────
# Detect >100 API calls per minute from a single agent
check_api_spike() {
    local client="$1"
    local threshold="${2:-100}"
    local audit_dir
    audit_dir="$(get_audit_dir_safe "$client")"
    [[ ! -d "$audit_dir" ]] && return 0

    local today
    today=$(date -u +"%Y-%m-%d")
    local log_file="${audit_dir}/${today}.jsonl"
    [[ ! -f "$log_file" ]] && return 0

    # Check last minute of API calls
    local one_min_ago
    one_min_ago=$(date -u -d "1 minute ago" +"%Y-%m-%dT%H:%M" 2>/dev/null || date -u -v-1M +"%Y-%m-%dT%H:%M" 2>/dev/null || return 0)

    # Count API calls per agent in last minute
    local spike_agents
    spike_agents=$(grep '"type":"api_call"' "$log_file" 2>/dev/null | \
        grep "\"ts\":\"${one_min_ago}" 2>/dev/null | \
        grep -oP '"agent":"[^"]*"' | sort | uniq -c | sort -rn | \
        awk -v t="$threshold" '$1 > t {print $0}')

    if [[ -n "$spike_agents" ]]; then
        while IFS= read -r line; do
            local count agent
            count=$(echo "$line" | awk '{print $1}')
            agent=$(echo "$line" | grep -oP '"[^"]*"' | tr -d '"')
            fire_alert "WARNING" "$client" "api_spike" \
                "Agent '${agent}' made ${count} API calls in last minute (threshold: ${threshold})"
        done <<< "$spike_agents"
    fi
}

# ── Rule 2: New External Endpoint ────────────────────────────────────
# Detect agents contacting hosts not in egress allowlist
check_new_endpoints() {
    local client="$1"
    local audit_dir
    audit_dir="$(get_audit_dir_safe "$client")"
    [[ ! -d "$audit_dir" ]] && return 0

    local today
    today=$(date -u +"%Y-%m-%d")
    local log_file="${audit_dir}/${today}.jsonl"
    [[ ! -f "$log_file" ]] && return 0

    # Load known endpoints from egress config
    local egress_config="${HEXOS_BASE}/${client}/config/egress.yaml"
    local known_hosts=""
    if [[ -f "$egress_config" ]]; then
        known_hosts=$(grep -oP 'host:\s*"?([^"}\s]+)' "$egress_config" 2>/dev/null | sed 's/host:\s*"*//' | tr '\n' '|')
    fi

    # Check today's API calls for new endpoints
    local endpoints
    endpoints=$(grep '"type":"api_call"' "$log_file" 2>/dev/null | \
        grep -oP '"endpoint":"[^"]*"' | cut -d'"' -f4 | \
        grep -oP 'https?://[^/]+' | sort -u)

    if [[ -n "$endpoints" ]]; then
        while IFS= read -r endpoint; do
            local host
            host=$(echo "$endpoint" | sed 's|https\?://||' | cut -d: -f1)
            # Check if host is known
            if [[ -n "$known_hosts" ]]; then
                if ! echo "$host" | grep -qP "^(${known_hosts%|})$"; then
                    fire_alert "WARNING" "$client" "new_endpoint" \
                        "Agent contacted unknown endpoint: ${endpoint} (host: ${host})"
                fi
            fi
        done <<< "$endpoints"
    fi
}

# ── Rule 3: Repeated Failures ───────────────────────────────────────
# Detect >10 consecutive errors
check_repeated_failures() {
    local client="$1"
    local threshold="${2:-10}"
    local audit_dir
    audit_dir="$(get_audit_dir_safe "$client")"
    [[ ! -d "$audit_dir" ]] && return 0

    local today
    today=$(date -u +"%Y-%m-%d")
    local log_file="${audit_dir}/${today}.jsonl"
    [[ ! -f "$log_file" ]] && return 0

    # Count consecutive errors at end of file
    local consecutive_errors=0
    tac "$log_file" | while IFS= read -r line; do
        local status
        status=$(echo "$line" | grep -oP '"status":"[^"]*"' | head -1 | cut -d'"' -f4)
        if [[ "$status" == "error" ]] || [[ "$status" == "failure" ]]; then
            consecutive_errors=$((consecutive_errors + 1))
            if [[ $consecutive_errors -ge $threshold ]]; then
                fire_alert "CRITICAL" "$client" "repeated_failures" \
                    "${consecutive_errors} consecutive errors detected"
                break
            fi
        else
            break
        fi
    done
}

# ── Rule 4: Approval Timeouts ───────────────────────────────────────
# Detect auto-rejected approvals
check_approval_timeouts() {
    local client="$1"
    local audit_dir
    audit_dir="$(get_audit_dir_safe "$client")"
    [[ ! -d "$audit_dir" ]] && return 0

    local today
    today=$(date -u +"%Y-%m-%d")
    local log_file="${audit_dir}/${today}.jsonl"
    [[ ! -f "$log_file" ]] && return 0

    local timeout_count
    timeout_count=$(grep '"type":"approval"' "$log_file" 2>/dev/null | \
        grep -c '"Auto-rejected.*timeout"' 2>/dev/null || echo "0")

    if [[ "$timeout_count" -gt 0 ]]; then
        fire_alert "WARNING" "$client" "approval_timeout" \
            "${timeout_count} approval request(s) auto-rejected due to timeout today"
    fi
}

# ── Helper ───────────────────────────────────────────────────────────
get_audit_dir_safe() {
    local client="$1"
    local dir="${HEXOS_BASE}/${client}/audit"
    [[ -d "$dir" ]] || dir="/tmp/hexos-audit/${client}"
    echo "$dir"
}

# ── Run All Checks ──────────────────────────────────────────────────
run_checks() {
    local client="$1"
    echo "Running audit alert checks for '${client}'..."
    check_api_spike "$client"
    check_new_endpoints "$client"
    check_repeated_failures "$client"
    check_approval_timeouts "$client"
    echo "Alert checks complete for '${client}'"
}

run_checks_all() {
    echo "Running audit alert checks for all clients..."
    for client_dir in "${HEXOS_BASE}"/*/audit; do
        [[ -d "$client_dir" ]] || continue
        local client
        client=$(basename "$(dirname "$client_dir")")
        [[ "$client" == "platform" ]] && continue
        run_checks "$client"
    done
    # Also check /tmp fallback
    for client_dir in /tmp/hexos-audit/*/; do
        [[ -d "$client_dir" ]] || continue
        local client
        client=$(basename "$client_dir")
        run_checks "$client"
    done
}

# ── Retention / Cleanup ─────────────────────────────────────────────
# Default: 90 days, configurable per client
audit_cleanup() {
    local dry_run=false
    [[ "${1:-}" == "--dry-run" ]] && dry_run=true

    local default_retention=90

    echo "╔══════════════════════════════════════════════════╗"
    echo "║  Audit Log Cleanup                                ║"
    echo "╚══════════════════════════════════════════════════╝"
    echo ""

    # Process each client
    local total_archived=0 total_deleted=0

    for audit_dir in "${HEXOS_BASE}"/*/audit /tmp/hexos-audit/*/; do
        [[ -d "$audit_dir" ]] || continue
        local client
        client=$(basename "$(dirname "$audit_dir")")
        [[ "$client" == "platform" ]] && continue

        # Check for client-specific retention in YAML
        local retention=$default_retention
        local client_config="${HEXOS_BASE}/${client}/config/audit.yaml"
        if [[ -f "$client_config" ]]; then
            local custom_retention
            custom_retention=$(grep -oP 'retention_days:\s*\K[0-9]+' "$client_config" 2>/dev/null || echo "")
            [[ -n "$custom_retention" ]] && retention=$custom_retention
        fi

        local cutoff_date
        cutoff_date=$(date -u -d "${retention} days ago" +"%Y-%m-%d" 2>/dev/null || \
                      date -u -v-${retention}d +"%Y-%m-%d" 2>/dev/null || continue)

        echo "  Client: ${client} (retention: ${retention} days, cutoff: ${cutoff_date})"

        for log_file in "${audit_dir}"/*.jsonl; do
            [[ -f "$log_file" ]] || continue
            local file_date
            file_date=$(basename "$log_file" .jsonl)

            if [[ "$file_date" < "$cutoff_date" ]]; then
                if [[ "$dry_run" == "true" ]]; then
                    echo "    [DRY RUN] Would archive and delete: $(basename "$log_file")"
                else
                    # Archive to .gz before deletion
                    gzip -k "$log_file" 2>/dev/null && {
                        echo "    Archived: $(basename "$log_file").gz"
                        total_archived=$((total_archived + 1))
                    }
                    rm -f "$log_file"
                    echo "    Deleted: $(basename "$log_file")"
                    total_deleted=$((total_deleted + 1))
                fi
            fi
        done

        # Also clean very old .gz files (retention * 2)
        local gz_cutoff
        gz_cutoff=$(date -u -d "$((retention * 2)) days ago" +"%Y-%m-%d" 2>/dev/null || continue)
        for gz_file in "${audit_dir}"/*.jsonl.gz; do
            [[ -f "$gz_file" ]] || continue
            local gz_date
            gz_date=$(basename "$gz_file" .jsonl.gz)
            if [[ "$gz_date" < "$gz_cutoff" ]]; then
                if [[ "$dry_run" == "true" ]]; then
                    echo "    [DRY RUN] Would delete old archive: $(basename "$gz_file")"
                else
                    rm -f "$gz_file"
                    echo "    Deleted archive: $(basename "$gz_file")"
                fi
            fi
        done
    done

    echo ""
    if [[ "$dry_run" == "true" ]]; then
        echo "  Dry run complete. No files were modified."
    else
        echo "  Archived: ${total_archived} files"
        echo "  Deleted:  ${total_deleted} files"
    fi
    echo ""
}

# ── Main ─────────────────────────────────────────────────────────────
case "${1:-help}" in
    check)
        run_checks "${2:?Client required}"
        ;;
    check-all)
        run_checks_all
        ;;
    cleanup)
        audit_cleanup "${2:-}"
        ;;
    *)
        echo "Usage: alerts.sh {check <client>|check-all|cleanup [--dry-run]}"
        ;;
esac
