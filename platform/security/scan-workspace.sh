#!/usr/bin/env bash
# HexOS Phase 1.5 — Workspace Audit Scanner
# Full workspace scan with baseline comparison for drift detection.
#
# Usage: scan-workspace.sh <workspace-path> <client-id> [policy-file]
# Exit: 0=clean, 1=threats found, 2=drift detected (warn), 3=error
# -----------------------------------------------------------------------
set -uo pipefail

SECURITY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCANNER="${SECURITY_DIR}/scanner.sh"
BASELINES_DIR="${BASELINES_DIR:-/tmp/hexos-security-baselines}"
REPORTS_DIR="${REPORTS_DIR:-/tmp/hexos-security-reports}"

WORKSPACE_PATH="${1:-}"
CLIENT_ID="${2:-}"
POLICY_FILE="${3:-}"

if [[ -z "$WORKSPACE_PATH" || -z "$CLIENT_ID" ]]; then
    echo "Usage: scan-workspace.sh <workspace-path> <client-id> [policy-file]" >&2
    exit 3
fi

if [[ ! -d "$WORKSPACE_PATH" ]]; then
    echo '{"error":"Workspace path does not exist","path":"'"$WORKSPACE_PATH"'"}'
    exit 3
fi

# Resolve policy
[[ -z "$POLICY_FILE" ]] && POLICY_FILE="${SECURITY_DIR}/policies/default.yaml"

mkdir -p "$BASELINES_DIR" "$REPORTS_DIR" 2>/dev/null

BASELINE_FILE="${BASELINES_DIR}/${CLIENT_ID}.baseline"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

# ---------------------------------------------------------------------------
# Step 1: Generate current file manifest (path + sha256)
# ---------------------------------------------------------------------------
CURRENT_MANIFEST=$(mktemp /tmp/hexos-manifest-XXXXXX)
trap "rm -f '$CURRENT_MANIFEST'" EXIT

find "$WORKSPACE_PATH" -type f -not -path '*/.git/*' -not -path '*/node_modules/*' -print0 2>/dev/null \
    | while IFS= read -r -d '' file; do
        sha=$(sha256sum "$file" 2>/dev/null | cut -d' ' -f1)
        echo "${sha}  ${file}"
    done | sort -k2 > "$CURRENT_MANIFEST"

FILES_SCANNED=$(wc -l < "$CURRENT_MANIFEST")

# ---------------------------------------------------------------------------
# Step 2: Drift detection (compare with baseline)
# ---------------------------------------------------------------------------
DRIFT_NEW=0
DRIFT_MODIFIED=0
DRIFT_DELETED=0

if [[ -f "$BASELINE_FILE" ]]; then
    # New files: in current but not in baseline (by path)
    DRIFT_NEW=$(comm -23 <(awk '{print $2}' "$CURRENT_MANIFEST" | sort) \
                         <(awk '{print $2}' "$BASELINE_FILE" | sort) | wc -l)

    # Deleted files: in baseline but not in current
    DRIFT_DELETED=$(comm -13 <(awk '{print $2}' "$CURRENT_MANIFEST" | sort) \
                             <(awk '{print $2}' "$BASELINE_FILE" | sort) | wc -l)

    # Modified files: same path but different hash
    DRIFT_MODIFIED=0
    while IFS= read -r line; do
        local_hash=$(echo "$line" | awk '{print $1}')
        local_path=$(echo "$line" | awk '{print $2}')
        baseline_hash=$(grep "  ${local_path}$" "$BASELINE_FILE" 2>/dev/null | awk '{print $1}')
        if [[ -n "$baseline_hash" && "$local_hash" != "$baseline_hash" ]]; then
            DRIFT_MODIFIED=$((DRIFT_MODIFIED + 1))
        fi
    done < "$CURRENT_MANIFEST"

    TOTAL_DRIFT=$((DRIFT_NEW + DRIFT_MODIFIED + DRIFT_DELETED))
else
    TOTAL_DRIFT=0
fi

# ---------------------------------------------------------------------------
# Step 3: Threat scan (scan all files for malicious patterns)
# ---------------------------------------------------------------------------
SCAN_RESULT=$("$SCANNER" "workspace" "$WORKSPACE_PATH" "$POLICY_FILE" 2>/dev/null)
SCAN_EXIT=$?

# Extract findings count from result
TOTAL_FINDINGS=$(echo "$SCAN_RESULT" | grep -o '"total_findings":[0-9]*' | cut -d: -f2)
TOTAL_FINDINGS="${TOTAL_FINDINGS:-0}"
FINDINGS_ARRAY=$(echo "$SCAN_RESULT" | grep -o '"findings":\[.*\]' | sed 's/"findings"://')
FINDINGS_ARRAY="${FINDINGS_ARRAY:-[]}"

# ---------------------------------------------------------------------------
# Step 4: Update baseline
# ---------------------------------------------------------------------------
cp "$CURRENT_MANIFEST" "$BASELINE_FILE" 2>/dev/null

# ---------------------------------------------------------------------------
# Step 5: Compose final result
# ---------------------------------------------------------------------------
# Determine final exit code: threats trump drift
FINAL_EXIT=0
if [[ $SCAN_EXIT -eq 1 ]]; then
    FINAL_EXIT=1  # threats found
elif [[ $TOTAL_DRIFT -gt 0 ]]; then
    FINAL_EXIT=2  # drift detected (warn)
fi

ACTION="pass"
case $FINAL_EXIT in
    0) ACTION="pass" ;;
    1) ACTION="fail" ;;
    2) ACTION="warn" ;;
esac

cat <<EOF
{"scanner":"builtin","total_findings":${TOTAL_FINDINGS},"files_scanned":${FILES_SCANNED},"drift":{"new":${DRIFT_NEW},"modified":${DRIFT_MODIFIED},"deleted":${DRIFT_DELETED},"total":${TOTAL_DRIFT}},"findings":${FINDINGS_ARRAY},"action":"${ACTION}","client_id":"${CLIENT_ID}","timestamp":"${TIMESTAMP}"}
EOF

# Archive report
REPORT_FILE="${REPORTS_DIR}/workspace-${CLIENT_ID}-${TIMESTAMP}.json"
echo "$SCAN_RESULT" > "$REPORT_FILE" 2>/dev/null || true

# Alert on threats
if [[ $FINAL_EXIT -eq 1 ]] && [[ -x "${SECURITY_DIR}/alert.sh" ]]; then
    "${SECURITY_DIR}/alert.sh" "critical" "$CLIENT_ID" "workspace" \
        "Workspace audit: ${TOTAL_FINDINGS} threat(s) detected, ${TOTAL_DRIFT} files changed" 2>/dev/null || true
elif [[ $TOTAL_DRIFT -gt 10 ]] && [[ -x "${SECURITY_DIR}/alert.sh" ]]; then
    "${SECURITY_DIR}/alert.sh" "medium" "$CLIENT_ID" "workspace" \
        "Workspace drift: ${TOTAL_DRIFT} files changed (${DRIFT_NEW} new, ${DRIFT_MODIFIED} modified, ${DRIFT_DELETED} deleted)" 2>/dev/null || true
fi

exit $FINAL_EXIT
