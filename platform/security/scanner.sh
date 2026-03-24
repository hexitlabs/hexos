#!/usr/bin/env bash
# HexOS Phase 1.5 — Scanner Abstraction Layer
# Main scanner interface — routes to configured backend.
#
# Usage: scanner.sh <scan-type> <target> [policy-file] [output-dir]
#   scan-type: skill | exec | workspace | file
#   target:    directory path (skill/workspace) or command string (exec) or file
#   policy:    YAML policy file (default: policies/default.yaml)
#   output-dir: where to write JSON report (optional)
#
# Exit codes:  0 = pass   1 = fail (threat)   2 = warn   3 = error
#
# Environment:
#   HEXOS_SCANNER_BACKEND  — backend to use (builtin, defenseclaw)
# -----------------------------------------------------------------------
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKENDS_DIR="${SCRIPT_DIR}/backends"
DEFAULT_POLICY="${SCRIPT_DIR}/policies/default.yaml"
DEFAULT_BACKEND="builtin"

# --- Argument parsing ---
SCAN_TYPE="${1:-}"
TARGET="${2:-}"
POLICY_FILE="${3:-$DEFAULT_POLICY}"
OUTPUT_DIR="${4:-}"

usage() {
    cat <<EOF
HexOS Security Scanner v0.1.0

Usage: scanner.sh <scan-type> <target> [policy-file] [output-dir]

Scan Types:
  skill       Scan a skill directory before installation
  exec        Scan a command string before execution
  workspace   Scan an entire client workspace
  file        Scan a single file

Exit Codes:
  0  PASS    — No threats detected
  1  FAIL    — Threat detected, blocked
  2  WARN    — Suspicious patterns, logged
  3  ERROR   — Scanner error
EOF
    exit 3
}

[[ -z "$SCAN_TYPE" || -z "$TARGET" ]] && usage

case "$SCAN_TYPE" in
    skill|exec|workspace|file) ;;
    *) echo "Error: Invalid scan type: $SCAN_TYPE" >&2; exit 3 ;;
esac

[[ ! -f "$POLICY_FILE" ]] && { echo "Error: Policy file not found: $POLICY_FILE" >&2; exit 3; }

# --- Policy helpers ---
policy_get() {
    local key="$1" default="${2:-}"
    local val
    val=$(grep -E "^\s+${key}:" "$POLICY_FILE" 2>/dev/null | head -1 | sed 's/^[^:]*:\s*//' | sed 's/\s*#.*//' | tr -d '[:space:]') || true
    echo "${val:-$default}"
}

SCAN_MODE=$(policy_get "mode" "strict")

# --- Backend selection ---
BACKEND="${HEXOS_SCANNER_BACKEND:-$DEFAULT_BACKEND}"

resolve_backend() {
    case "$BACKEND" in
        builtin)
            echo "${BACKENDS_DIR}/builtin-scanner.sh"
            ;;
        defenseclaw)
            if command -v defenseclaw &>/dev/null; then
                echo "${BACKENDS_DIR}/defenseclaw-backend.sh"
            else
                echo "Warning: defenseclaw not found, falling back to builtin" >&2
                echo "${BACKENDS_DIR}/builtin-scanner.sh"
            fi
            ;;
        *)
            echo "Error: Unknown backend: $BACKEND" >&2
            exit 3
            ;;
    esac
}

BACKEND_SCRIPT=$(resolve_backend)
[[ ! -x "$BACKEND_SCRIPT" ]] && { echo "Error: Backend not executable: $BACKEND_SCRIPT" >&2; exit 3; }

# --- Map scan-type to backend args ---
SCAN_START_NS=$(date +%s%N 2>/dev/null || echo "0")

case "$SCAN_TYPE" in
    skill)
        [[ ! -d "$TARGET" ]] && { echo '{"error":"Skill directory not found"}' ; exit 3; }
        BACKEND_RESULT=$("$BACKEND_SCRIPT" dir "$TARGET" "$POLICY_FILE")
        BACKEND_EXIT=$?
        ;;
    exec)
        BACKEND_RESULT=$("$BACKEND_SCRIPT" string "$TARGET" "$POLICY_FILE")
        BACKEND_EXIT=$?
        ;;
    workspace)
        [[ ! -d "$TARGET" ]] && { echo '{"error":"Workspace not found"}' ; exit 3; }
        BACKEND_RESULT=$("$BACKEND_SCRIPT" dir "$TARGET" "$POLICY_FILE")
        BACKEND_EXIT=$?
        ;;
    file)
        [[ ! -f "$TARGET" ]] && { echo '{"error":"File not found"}' ; exit 3; }
        BACKEND_RESULT=$("$BACKEND_SCRIPT" file "$TARGET" "$POLICY_FILE")
        BACKEND_EXIT=$?
        ;;
esac

SCAN_END_NS=$(date +%s%N 2>/dev/null || echo "0")
if [[ ${#SCAN_START_NS} -gt 10 && ${#SCAN_END_NS} -gt 10 ]]; then
    DURATION_MS=$(( (SCAN_END_NS - SCAN_START_NS) / 1000000 ))
else
    DURATION_MS=0
fi

# --- Parse backend result ---
TOTAL_FINDINGS=$(echo "$BACKEND_RESULT" | grep -o '"total_findings":[0-9]*' | head -1 | cut -d: -f2 || echo "0")
HIGHEST_RISK=$(echo "$BACKEND_RESULT" | grep -o '"highest_risk":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "none")
FINDINGS_ARRAY=$(echo "$BACKEND_RESULT" | grep -o '"findings":\[.*\]' | sed 's/"findings"://' || echo "[]")
[[ -z "$TOTAL_FINDINGS" ]] && TOTAL_FINDINGS=0
[[ -z "$HIGHEST_RISK" ]] && HIGHEST_RISK="none"
[[ -z "$FINDINGS_ARRAY" ]] && FINDINGS_ARRAY="[]"

# --- Determine action based on policy mode + risk ---
ACTION="pass"
FINAL_EXIT=0

if [[ $TOTAL_FINDINGS -gt 0 ]]; then
    RISK_ACTION=$(policy_get "$HIGHEST_RISK" "fail")
    if [[ "$SCAN_MODE" == "permissive" ]]; then
        ACTION="warn"
        FINAL_EXIT=2
    else
        ACTION="$RISK_ACTION"
        case "$RISK_ACTION" in
            fail) FINAL_EXIT=1 ;;
            warn) FINAL_EXIT=2 ;;
            pass) FINAL_EXIT=0 ;;
            *) FINAL_EXIT=1 ;;
        esac
    fi
fi

# --- Count files scanned (for dir scans) ---
FILES_SCANNED=0
if [[ "$SCAN_TYPE" == "skill" || "$SCAN_TYPE" == "workspace" || "$SCAN_TYPE" == "file" ]]; then
    if [[ -d "$TARGET" ]]; then
        FILES_SCANNED=$(find "$TARGET" -type f 2>/dev/null | wc -l)
    else
        FILES_SCANNED=1
    fi
fi

# --- Build envelope JSON ---
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
ESCAPED_TARGET=$(echo "$TARGET" | sed 's/\\/\\\\/g; s/"/\\"/g')
ESCAPED_POLICY=$(echo "$POLICY_FILE" | sed 's/\\/\\\\/g; s/"/\\"/g')

REPORT=$(cat <<EOF
{"scanner":"builtin","version":"0.1.0","timestamp":"${TIMESTAMP}","scan_type":"${SCAN_TYPE}","target":"${ESCAPED_TARGET}","policy":"${ESCAPED_POLICY}","mode":"${SCAN_MODE}","duration_ms":${DURATION_MS},"files_scanned":${FILES_SCANNED},"total_findings":${TOTAL_FINDINGS},"max_severity":"${HIGHEST_RISK}","action":"${ACTION}","findings":${FINDINGS_ARRAY}}
EOF
)

# --- Output ---
if [[ -n "$OUTPUT_DIR" ]]; then
    mkdir -p "$OUTPUT_DIR" 2>/dev/null || true
    REPORT_FILE="${OUTPUT_DIR}/scan-${SCAN_TYPE}-$(date +%Y%m%d-%H%M%S).json"
    echo "$REPORT" > "$REPORT_FILE"
    echo "$REPORT_FILE" >&2
fi

echo "$REPORT"
exit $FINAL_EXIT
