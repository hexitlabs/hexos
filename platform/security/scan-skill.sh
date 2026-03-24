#!/usr/bin/env bash
# HexOS Phase 1.5 — Skill Installation Scanner Gate
# Scans skill directories before installation.
#
# Usage: scan-skill.sh <skill-path> [client-name] [policy-file]
# Exit: 0=pass, 1=fail (threat), 2=warn, 3=error
# -----------------------------------------------------------------------
set -uo pipefail

SECURITY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCANNER="${SECURITY_DIR}/scanner.sh"

SKILL_PATH="${1:-}"
CLIENT_NAME="${2:-}"
POLICY_FILE="${3:-}"

if [[ -z "$SKILL_PATH" ]]; then
    echo "Usage: scan-skill.sh <skill-path> [client-name] [policy-file]" >&2
    exit 3
fi

if [[ ! -d "$SKILL_PATH" ]]; then
    echo '{"error":"Skill path does not exist","path":"'"$SKILL_PATH"'"}'
    exit 3
fi

# Resolve policy
if [[ -z "$POLICY_FILE" && -n "$CLIENT_NAME" ]]; then
    CLIENT_POLICY="/hexos/${CLIENT_NAME}/security/policies/scan-policy.yaml"
    [[ -f "$CLIENT_POLICY" ]] && POLICY_FILE="$CLIENT_POLICY"
fi
[[ -z "$POLICY_FILE" ]] && POLICY_FILE="${SECURITY_DIR}/policies/default.yaml"

# Output directory
OUTPUT_DIR=""
if [[ -n "$CLIENT_NAME" ]]; then
    OUTPUT_DIR="/hexos/${CLIENT_NAME}/security/reports/$(date +%Y-%m-%d)"
    mkdir -p "$OUTPUT_DIR" 2>/dev/null || OUTPUT_DIR=""
fi

# Run scanner
RESULT=$("$SCANNER" "skill" "$SKILL_PATH" "$POLICY_FILE" "$OUTPUT_DIR")
EXIT_CODE=$?

echo "$RESULT"

# Alert on findings
if [[ $EXIT_CODE -eq 1 || $EXIT_CODE -eq 2 ]] && [[ -x "${SECURITY_DIR}/alert.sh" ]]; then
    SEVERITY="high"
    [[ $EXIT_CODE -eq 1 ]] && SEVERITY="critical"
    SKILL_NAME=$(basename "$SKILL_PATH")
    FINDINGS=$(echo "$RESULT" | grep -o '"total_findings":[0-9]*' | cut -d: -f2 2>/dev/null || echo "0")
    "${SECURITY_DIR}/alert.sh" "$SEVERITY" "${CLIENT_NAME:-unknown}" "skill" \
        "Skill '${SKILL_NAME}' blocked: ${FINDINGS} threat(s) detected" 2>/dev/null || true
fi

exit $EXIT_CODE
