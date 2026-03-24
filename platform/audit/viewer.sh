#!/usr/bin/env bash
# HexOS Phase 6 — Audit Viewer
# CLI for viewing, searching, and analyzing audit logs
#
# Usage:
#   viewer.sh log <client> [options]
#   viewer.sh search <client> <query>
#   viewer.sh stats <client> [--period day|week|month]
set -euo pipefail

HEXOS_BASE="${HEXOS_BASE:-/hexos}"

# ── Color Helpers ────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'

# ── Resolve Audit Dir ────────────────────────────────────────────────
get_audit_dir() {
    local client="$1"
    local dir="${HEXOS_BASE}/${client}/audit"
    [[ -d "$dir" ]] || dir="/tmp/hexos-audit/${client}"
    echo "$dir"
}

# ── View Log ─────────────────────────────────────────────────────────
cmd_log() {
    local client="${1:?Client required}"
    shift

    local today=false
    local last=0
    local type_filter=""
    local date_filter=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --today)    today=true; shift ;;
            --last)     last="${2:?Count required}"; shift 2 ;;
            --type)     type_filter="$2"; shift 2 ;;
            --date)     date_filter="$2"; shift 2 ;;
            *)          shift ;;
        esac
    done

    local audit_dir
    audit_dir="$(get_audit_dir "$client")"

    if [[ ! -d "$audit_dir" ]]; then
        echo "No audit logs found for client '${client}'"
        return 1
    fi

    # Determine which file to read
    local log_file
    if [[ -n "$date_filter" ]]; then
        log_file="${audit_dir}/${date_filter}.jsonl"
    elif [[ "$today" == "true" ]]; then
        log_file="${audit_dir}/$(date -u +"%Y-%m-%d").jsonl"
    else
        # Find the most recent log file
        log_file=$(ls -t "${audit_dir}"/*.jsonl 2>/dev/null | head -1)
    fi

    if [[ -z "$log_file" ]] || [[ ! -f "$log_file" ]]; then
        echo "No log entries found"
        return 0
    fi

    echo -e "${BOLD}Audit Log: ${client}${NC}"
    echo -e "${BOLD}File: $(basename "$log_file")${NC}"
    echo "────────────────────────────────────────────────"

    local data
    if [[ -n "$type_filter" ]]; then
        data=$(grep "\"type\":\"${type_filter}\"" "$log_file" 2>/dev/null || true)
    else
        data=$(cat "$log_file")
    fi

    if [[ $last -gt 0 ]]; then
        data=$(echo "$data" | tail -n "$last")
    fi

    # Pretty-print entries
    echo "$data" | while IFS= read -r line; do
        [[ -z "$line" ]] && continue
        local ts type agent tool status
        ts=$(echo "$line" | grep -oP '"ts":"[^"]*"' | head -1 | cut -d'"' -f4)
        type=$(echo "$line" | grep -oP '"type":"[^"]*"' | head -1 | cut -d'"' -f4)
        agent=$(echo "$line" | grep -oP '"agent":"[^"]*"' | head -1 | cut -d'"' -f4)
        tool=$(echo "$line" | grep -oP '"tool":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
        status=$(echo "$line" | grep -oP '"status":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")

        # Color-code by type
        local type_color="$NC"
        case "$type" in
            tool_call)       type_color="$CYAN" ;;
            api_call)        type_color="$BLUE" ;;
            security_event)  type_color="$RED" ;;
            system_event)    type_color="$YELLOW" ;;
            approval)        type_color="$GREEN" ;;
        esac

        local status_icon="•"
        case "$status" in
            success|approved) status_icon="✓" ;;
            error|rejected)   status_icon="✗" ;;
            pending)          status_icon="⏳" ;;
        esac

        printf "  %s ${type_color}%-16s${NC} %-14s %-10s %s %s\n" \
            "$ts" "$type" "$agent" "${tool:-—}" "$status_icon" "$status"
    done

    echo "────────────────────────────────────────────────"
    local total
    total=$(echo "$data" | grep -c . || echo "0")
    echo "Total entries: ${total}"
}

# ── Search ───────────────────────────────────────────────────────────
cmd_search() {
    local client="${1:?Client required}"
    local query="${2:?Search query required}"

    local audit_dir
    audit_dir="$(get_audit_dir "$client")"

    if [[ ! -d "$audit_dir" ]]; then
        echo "No audit logs found for client '${client}'"
        return 1
    fi

    echo -e "${BOLD}Search: '${query}' in ${client}${NC}"
    echo "────────────────────────────────────────────────"

    local count=0
    for f in "${audit_dir}"/*.jsonl; do
        [[ -f "$f" ]] || continue
        local matches
        matches=$(grep -i "$query" "$f" 2>/dev/null || true)
        if [[ -n "$matches" ]]; then
            echo -e "${YELLOW}$(basename "$f"):${NC}"
            echo "$matches" | while IFS= read -r line; do
                local ts type
                ts=$(echo "$line" | grep -oP '"ts":"[^"]*"' | head -1 | cut -d'"' -f4)
                type=$(echo "$line" | grep -oP '"type":"[^"]*"' | head -1 | cut -d'"' -f4)
                echo "  ${ts}  ${type}  $(echo "$line" | grep -oiP "[^\"]{0,40}${query}[^\"]{0,40}" | head -1)"
                count=$((count + 1))
            done
        fi
    done

    echo "────────────────────────────────────────────────"
    echo "Found: ${count} matching entries"
}

# ── Stats ────────────────────────────────────────────────────────────
cmd_stats() {
    local client="${1:?Client required}"
    shift
    local period="day"

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --period) period="$2"; shift 2 ;;
            *)        shift ;;
        esac
    done

    local audit_dir
    audit_dir="$(get_audit_dir "$client")"

    if [[ ! -d "$audit_dir" ]]; then
        echo "No audit logs found for client '${client}'"
        return 1
    fi

    echo ""
    echo "╔══════════════════════════════════════════════════╗"
    echo "║  Audit Statistics: ${client}"
    echo "╚══════════════════════════════════════════════════╝"
    echo ""

    # Determine date range
    local start_date
    case "$period" in
        day)   start_date=$(date -u +"%Y-%m-%d") ;;
        week)  start_date=$(date -u -d "7 days ago" +"%Y-%m-%d" 2>/dev/null || date -u -v-7d +"%Y-%m-%d" 2>/dev/null || date -u +"%Y-%m-%d") ;;
        month) start_date=$(date -u -d "30 days ago" +"%Y-%m-%d" 2>/dev/null || date -u -v-30d +"%Y-%m-%d" 2>/dev/null || date -u +"%Y-%m-%d") ;;
    esac

    local total=0 tool_calls=0 api_calls=0 system_events=0 security_events=0 approvals=0

    for f in "${audit_dir}"/*.jsonl; do
        [[ -f "$f" ]] || continue
        local file_date
        file_date=$(basename "$f" .jsonl)
        [[ "$file_date" < "$start_date" ]] && continue

        local file_count
        file_count=$(wc -l < "$f")
        total=$((total + file_count))
        tool_calls=$((tool_calls + $(grep -c '"type":"tool_call"' "$f" 2>/dev/null || echo 0)))
        api_calls=$((api_calls + $(grep -c '"type":"api_call"' "$f" 2>/dev/null || echo 0)))
        system_events=$((system_events + $(grep -c '"type":"system_event"' "$f" 2>/dev/null || echo 0)))
        security_events=$((security_events + $(grep -c '"type":"security_event"' "$f" 2>/dev/null || echo 0)))
        approvals=$((approvals + $(grep -c '"type":"approval"' "$f" 2>/dev/null || echo 0)))
    done

    echo "  Period:           ${period} (since ${start_date})"
    echo "  Total Events:     ${total}"
    echo ""
    echo "  By Type:"
    echo "    Tool Calls:     ${tool_calls}"
    echo "    API Calls:      ${api_calls}"
    echo "    System Events:  ${system_events}"
    echo "    Security:       ${security_events}"
    echo "    Approvals:      ${approvals}"

    # Top agents
    echo ""
    echo "  Top Agents:"
    for f in "${audit_dir}"/*.jsonl; do
        [[ -f "$f" ]] || continue
        local file_date
        file_date=$(basename "$f" .jsonl)
        [[ "$file_date" < "$start_date" ]] && continue
        cat "$f"
    done | grep -oP '"agent":"[^"]*"' | sort | uniq -c | sort -rn | head -5 | while read -r count agent; do
        agent=$(echo "$agent" | cut -d'"' -f4)
        printf "    %-20s %s events\n" "$agent" "$count"
    done

    # Log files on disk
    echo ""
    echo "  Storage:"
    local file_count disk_usage
    file_count=$(find "$audit_dir" -name "*.jsonl" 2>/dev/null | wc -l)
    disk_usage=$(du -sh "$audit_dir" 2>/dev/null | awk '{print $1}' || echo "0")
    echo "    Log files:      ${file_count}"
    echo "    Disk usage:     ${disk_usage}"
    echo ""
}

# ── Main ─────────────────────────────────────────────────────────────
case "${1:-help}" in
    log)
        shift
        cmd_log "$@"
        ;;
    search)
        shift
        cmd_search "$@"
        ;;
    stats)
        shift
        cmd_stats "$@"
        ;;
    *)
        echo "Usage: viewer.sh {log|search|stats} <client> [options]"
        echo ""
        echo "  log <client> [--today] [--last N] [--type TYPE]"
        echo "  search <client> <query>"
        echo "  stats <client> [--period day|week|month]"
        ;;
esac
