#!/usr/bin/env bash
# HexOS Phase 1.5 — Exec Pre-Check Hook
# Scans commands before execution. Includes fast-path bypass for known-safe commands.
#
# Usage: scan-exec.sh <command> [client-name] [policy-file]
# Exit: 0=pass (safe), 1=fail (threat), 2=warn, 3=error
# -----------------------------------------------------------------------
set -uo pipefail

SECURITY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

COMMAND="${1:-}"
CLIENT_NAME="${2:-}"
POLICY_FILE="${3:-}"

if [[ -z "$COMMAND" ]]; then
    echo "Usage: scan-exec.sh <command> [client-name] [policy-file]"
    exit 3
fi

# Resolve policy
if [[ -z "$POLICY_FILE" && -n "$CLIENT_NAME" ]]; then
    CLIENT_POLICY="/hexos/${CLIENT_NAME}/security/policies/scan-policy.yaml"
    [[ -f "$CLIENT_POLICY" ]] && POLICY_FILE="$CLIENT_POLICY"
fi
[[ -z "$POLICY_FILE" ]] && POLICY_FILE="${SECURITY_DIR}/policies/default.yaml"

# ---------------------------------------------------------------------------
# Fast path: known-safe base commands (bypass deep scan)
# ---------------------------------------------------------------------------
BASE_CMD=$(echo "$COMMAND" | sed 's/^\s*//' | awk '{print $1}')
BASE_CMD=$(basename "$BASE_CMD" 2>/dev/null || echo "$BASE_CMD")

# Check for shell complexity (pipes, semicolons, subshells, redirects)
HAS_COMPLEXITY=false
echo "$COMMAND" | grep -qE '[|;&`$()]|>>|>&' && HAS_COMPLEXITY=true

# Known-safe commands map
declare -A FAST_SAFE=(
    [ls]=1 [cat]=1 [echo]=1 [pwd]=1 [whoami]=1 [date]=1
    [head]=1 [tail]=1 [wc]=1 [grep]=1 [find]=1 [sort]=1
    [node]=1 [npm]=1 [npx]=1 [git]=1 [which]=1 [env]=1
    [true]=1 [false]=1 [test]=1 [id]=1 [uname]=1 [hostname]=1
    [mkdir]=1 [touch]=1 [cp]=1 [mv]=1 [stat]=1 [file]=1
    [basename]=1 [dirname]=1 [realpath]=1 [readlink]=1
    [diff]=1 [less]=1 [more]=1 [tee]=1 [cut]=1 [tr]=1
    [sed]=1 [awk]=1 [jq]=1 [yq]=1 [python3]=1 [python]=1
    [uniq]=1 [tar]=1 [gzip]=1 [gunzip]=1 [zip]=1 [unzip]=1
    [make]=1 [cmake]=1 [yarn]=1 [pnpm]=1 [bun]=1 [deno]=1
)

# Quick check for high-signal threat keywords that should ALWAYS trigger deep scan
# even if the base command is "safe" (e.g. "echo stratum+tcp://...")
THREAT_KEYWORDS='stratum|xmrig|coinhive|meterpreter|/dev/tcp/|base64.+(-d|--decode)|mkfs|curl.+--upload|nc\s+-e|reverse.shell|cryptonight|mimikatz|cobalt.strike'
ARGS_SUSPICIOUS=false
if echo "$COMMAND" | grep -Piq "$THREAT_KEYWORDS" 2>/dev/null || \
   echo "$COMMAND" | grep -Eiq "$THREAT_KEYWORDS" 2>/dev/null; then
    ARGS_SUSPICIOUS=true
fi

# Fast path: simple command, known-safe base, no suspicious keywords
if [[ "$HAS_COMPLEXITY" == "false" && "$ARGS_SUSPICIOUS" == "false" && -n "${FAST_SAFE[$BASE_CMD]+x}" ]]; then
    echo '{"scanner":"builtin","total_findings":0,"highest_risk":"none","findings":[],"action":"pass","fast_path":true}'
    exit 0
fi

# ---------------------------------------------------------------------------
# Deep scan: run full pattern matching
# ---------------------------------------------------------------------------
RESULT=$("${SECURITY_DIR}/scanner.sh" "exec" "$COMMAND" "$POLICY_FILE" 2>/dev/null)
EXIT_CODE=$?

echo "$RESULT"

# Alert on threats
if [[ $EXIT_CODE -eq 1 || $EXIT_CODE -eq 2 ]] && [[ -x "${SECURITY_DIR}/alert.sh" ]]; then
    SEVERITY="high"
    [[ $EXIT_CODE -eq 1 ]] && SEVERITY="critical"
    SHORT_CMD="${COMMAND:0:100}"
    FINDINGS=$(echo "$RESULT" | grep -o '"total_findings":[0-9]*' | cut -d: -f2 2>/dev/null || echo "0")
    "${SECURITY_DIR}/alert.sh" "$SEVERITY" "${CLIENT_NAME:-unknown}" "exec" \
        "Blocked command (${FINDINGS} threat(s)): ${SHORT_CMD}" 2>/dev/null || true
fi

exit $EXIT_CODE
