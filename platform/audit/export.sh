#!/usr/bin/env bash
# HexOS Phase 6 — Audit Export System
# Export per-client audit logs as JSON or CSV
#
# Usage:
#   export.sh <client> [options]
#
# Options:
#   --from YYYY-MM-DD     Start date (default: 30 days ago)
#   --to YYYY-MM-DD       End date (default: today)
#   --format json|csv     Output format (default: json)
#   --output <file>       Output file (default: stdout)
#   --type <type>         Filter by event type
#   --gzip                Compress output
set -euo pipefail

HEXOS_BASE="${HEXOS_BASE:-/hexos}"

# ── Parse Arguments ──────────────────────────────────────────────────
CLIENT=""
FROM_DATE=""
TO_DATE=""
FORMAT="json"
OUTPUT=""
EVENT_TYPE=""
GZIP=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --from)    FROM_DATE="$2"; shift 2 ;;
        --to)      TO_DATE="$2"; shift 2 ;;
        --format)  FORMAT="$2"; shift 2 ;;
        --output)  OUTPUT="$2"; shift 2 ;;
        --type)    EVENT_TYPE="$2"; shift 2 ;;
        --gzip)    GZIP=true; shift ;;
        --help|-h)
            echo "Usage: hexos audit export <client> [options]"
            echo ""
            echo "Options:"
            echo "  --from YYYY-MM-DD     Start date (default: 30 days ago)"
            echo "  --to YYYY-MM-DD       End date (default: today)"
            echo "  --format json|csv     Output format (default: json)"
            echo "  --output <file>       Output file (default: stdout)"
            echo "  --type <type>         Filter by event type"
            echo "  --gzip                Compress output"
            exit 0
            ;;
        -*)
            echo "Unknown option: $1" >&2
            exit 1
            ;;
        *)
            CLIENT="$1"
            shift
            ;;
    esac
done

if [[ -z "$CLIENT" ]]; then
    echo "Error: Client name required" >&2
    exit 1
fi

# Default dates
if [[ -z "$FROM_DATE" ]]; then
    FROM_DATE=$(date -u -d "30 days ago" +"%Y-%m-%d" 2>/dev/null || date -u -v-30d +"%Y-%m-%d" 2>/dev/null || echo "2024-01-01")
fi
if [[ -z "$TO_DATE" ]]; then
    TO_DATE=$(date -u +"%Y-%m-%d")
fi

# Find audit directory
AUDIT_DIR="${HEXOS_BASE}/${CLIENT}/audit"
if [[ ! -d "$AUDIT_DIR" ]]; then
    AUDIT_DIR="/tmp/hexos-audit/${CLIENT}"
fi
if [[ ! -d "$AUDIT_DIR" ]]; then
    echo "Error: No audit directory found for client '${CLIENT}'" >&2
    exit 1
fi

# ── Collect Log Files ────────────────────────────────────────────────
collect_entries() {
    local current="$FROM_DATE"
    while [[ "$current" < "$TO_DATE" ]] || [[ "$current" == "$TO_DATE" ]]; do
        local log_file="${AUDIT_DIR}/${current}.jsonl"
        if [[ -f "$log_file" ]]; then
            if [[ -n "$EVENT_TYPE" ]]; then
                grep "\"type\":\"${EVENT_TYPE}\"" "$log_file" 2>/dev/null || true
            else
                cat "$log_file"
            fi
        fi
        # Increment date
        current=$(date -u -d "${current} + 1 day" +"%Y-%m-%d" 2>/dev/null || \
                  date -u -j -f "%Y-%m-%d" "${current}" -v+1d +"%Y-%m-%d" 2>/dev/null || \
                  break)
        # Safety: break if we're stuck
        [[ "$current" > "2099-12-31" ]] && break
    done
}

# ── JSON Export ──────────────────────────────────────────────────────
export_json() {
    echo "["
    local first=true
    collect_entries | while IFS= read -r line; do
        if [[ "$first" == "true" ]]; then
            first=false
        else
            echo ","
        fi
        printf "%s" "$line"
    done
    echo ""
    echo "]"
}

# ── CSV Export ───────────────────────────────────────────────────────
export_csv() {
    # CSV header
    echo "id,timestamp,client,agent,type,tool,input_summary,status,duration_ms,session"

    collect_entries | while IFS= read -r line; do
        # Extract fields using grep -oP (fast)
        local id ts client agent type tool input status duration session
        id=$(echo "$line" | grep -oP '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
        ts=$(echo "$line" | grep -oP '"ts":"[^"]*"' | head -1 | cut -d'"' -f4)
        client=$(echo "$line" | grep -oP '"client":"[^"]*"' | head -1 | cut -d'"' -f4)
        agent=$(echo "$line" | grep -oP '"agent":"[^"]*"' | head -1 | cut -d'"' -f4)
        type=$(echo "$line" | grep -oP '"type":"[^"]*"' | head -1 | cut -d'"' -f4)
        tool=$(echo "$line" | grep -oP '"tool":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
        input=$(echo "$line" | grep -oP '"input":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
        status=$(echo "$line" | grep -oP '"status":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
        duration=$(echo "$line" | grep -oP '"duration_ms":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
        session=$(echo "$line" | grep -oP '"session":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")

        # Truncate input for summary
        if [[ ${#input} -gt 80 ]]; then
            input="${input:0:77}..."
        fi
        # Escape commas and quotes for CSV
        input="${input//\"/\"\"}"

        echo "${id},${ts},${client},${agent},${type},${tool},\"${input}\",${status},${duration},${session}"
    done
}

# ── Execute Export ───────────────────────────────────────────────────
do_export() {
    case "$FORMAT" in
        json)
            export_json
            ;;
        csv)
            export_csv
            ;;
        *)
            echo "Error: Unknown format '${FORMAT}'. Use 'json' or 'csv'" >&2
            exit 1
            ;;
    esac
}

# Route output
if [[ -n "$OUTPUT" ]]; then
    if [[ "$GZIP" == "true" ]]; then
        do_export | gzip > "${OUTPUT}.gz"
        echo "Exported to ${OUTPUT}.gz" >&2
    else
        do_export > "$OUTPUT"
        echo "Exported to ${OUTPUT}" >&2
    fi
else
    if [[ "$GZIP" == "true" ]]; then
        do_export | gzip
    else
        do_export
    fi
fi
