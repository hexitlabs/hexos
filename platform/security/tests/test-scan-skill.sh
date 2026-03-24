#!/usr/bin/env bash
# HexOS Phase 1.5 — Test: Skill Scanner
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SECURITY_DIR="$(dirname "$SCRIPT_DIR")"
FIXTURES_DIR="${SCRIPT_DIR}/fixtures"

PASS=0
FAIL=0

test_result() {
    local desc="$1" expected="$2" actual="$3"
    if [[ "$expected" == "$actual" ]]; then
        echo "  ✅ PASS: ${desc} (exit=$actual)"
        PASS=$((PASS + 1))
    else
        echo "  ❌ FAIL: ${desc} (expected=$expected, got=$actual)"
        FAIL=$((FAIL + 1))
    fi
}

echo "═══ Test: Skill Scanner ═══"
echo ""

# Test 1: Malicious skill should be blocked
echo "Test 1: Malicious skill detection"
RESULT=$("${SECURITY_DIR}/scan-skill.sh" "${FIXTURES_DIR}/malicious-skill" 2>/dev/null)
EXIT_CODE=$?
test_result "Malicious skill blocked" "1" "$EXIT_CODE"

# Verify findings count > 0
FINDINGS=$(echo "$RESULT" | grep -o '"total_findings":[0-9]*' | cut -d: -f2)
if [[ "$FINDINGS" -gt 0 ]]; then
    echo "  ✅ PASS: Found ${FINDINGS} threat(s) in malicious skill"
    PASS=$((PASS + 1))
else
    echo "  ❌ FAIL: No threats detected in malicious skill"
    FAIL=$((FAIL + 1))
fi

# Check specific categories detected
for category in "dangerous_commands" "secrets" "exfiltration" "obfuscation" "malware" "privilege_escalation"; do
    if echo "$RESULT" | grep -q "\"category\":\"${category}\""; then
        echo "  ✅ PASS: Detected category: ${category}"
        PASS=$((PASS + 1))
    else
        echo "  ❌ FAIL: Missed category: ${category}"
        FAIL=$((FAIL + 1))
    fi
done

echo ""

# Test 2: Safe skill should pass
echo "Test 2: Safe skill passes"
RESULT=$("${SECURITY_DIR}/scan-skill.sh" "${FIXTURES_DIR}/safe-skill" 2>/dev/null)
EXIT_CODE=$?
test_result "Safe skill passes" "0" "$EXIT_CODE"

FINDINGS=$(echo "$RESULT" | grep -o '"total_findings":[0-9]*' | cut -d: -f2)
if [[ "$FINDINGS" -eq 0 ]]; then
    echo "  ✅ PASS: No false positives in safe skill"
    PASS=$((PASS + 1))
else
    echo "  ❌ FAIL: ${FINDINGS} false positive(s) in safe skill"
    FAIL=$((FAIL + 1))
fi

echo ""

# Test 3: Non-existent skill directory
echo "Test 3: Non-existent skill directory returns error"
"${SECURITY_DIR}/scan-skill.sh" "/nonexistent/path" 2>/dev/null
test_result "Non-existent path returns error" "3" "$?"

echo ""
echo "═══ Results: ${PASS} passed, ${FAIL} failed ═══"
exit $FAIL
