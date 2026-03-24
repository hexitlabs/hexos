#!/usr/bin/env bash
# HexOS Phase 1.5 — Test: Policy Engine
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SECURITY_DIR="$(dirname "$SCRIPT_DIR")"

PASS=0
FAIL=0

test_result() {
    local desc="$1" expected="$2" actual="$3"
    if [[ "$expected" == "$actual" ]]; then
        echo "  ✅ PASS: ${desc}"
        PASS=$((PASS + 1))
    else
        echo "  ❌ FAIL: ${desc} (expected=$expected, got=$actual)"
        FAIL=$((FAIL + 1))
    fi
}

echo "═══ Test: Policy Engine ═══"
echo ""

# Test 1: Validate default policy
echo "Test 1: Default policy validation"
"${SECURITY_DIR}/policy-loader.sh" validate "${SECURITY_DIR}/policies/default.yaml" >/dev/null 2>&1
test_result "Default policy is valid" "0" "$?"

echo ""

# Test 2: Validate invalid policy
echo "Test 2: Invalid policy detection"
INVALID_POLICY=$(mktemp /tmp/hexos-test-policy-XXXXXX.yaml)
cat > "$INVALID_POLICY" <<EOF
# Missing scan: key
mode: strict
EOF
"${SECURITY_DIR}/policy-loader.sh" validate "$INVALID_POLICY" >/dev/null 2>&1
test_result "Missing scan: key detected" "1" "$?"

# Test with invalid mode
cat > "$INVALID_POLICY" <<EOF
scan:
  mode: invalid_mode
  extensions: [.js]
  exclude: [node_modules/]
  risk_levels:
    critical: fail
    high: fail
    medium: warn
    low: pass
EOF
"${SECURITY_DIR}/policy-loader.sh" validate "$INVALID_POLICY" >/dev/null 2>&1
test_result "Invalid mode value detected" "1" "$?"

# Test with valid permissive mode
cat > "$INVALID_POLICY" <<EOF
scan:
  mode: permissive
  extensions: [.js, .ts]
  exclude: [node_modules/]
  risk_levels:
    critical: fail
    high: warn
    medium: warn
    low: pass
EOF
"${SECURITY_DIR}/policy-loader.sh" validate "$INVALID_POLICY" >/dev/null 2>&1
test_result "Valid permissive policy passes" "0" "$?"

rm -f "$INVALID_POLICY"

echo ""

# Test 3: Policy resolution (default when no client override)
echo "Test 3: Policy resolution"
RESOLVED=$("${SECURITY_DIR}/policy-loader.sh" resolve "nonexistent-client" 2>/dev/null)
if echo "$RESOLVED" | grep -q "default.yaml"; then
    echo "  ✅ PASS: Falls back to default policy"
    PASS=$((PASS + 1))
else
    echo "  ❌ FAIL: Did not fall back to default (got: $RESOLVED)"
    FAIL=$((FAIL + 1))
fi

echo ""

# Test 4: Get policy value
echo "Test 4: Get policy value"
MODE=$("${SECURITY_DIR}/policy-loader.sh" get "nonexistent-client" "mode" 2>/dev/null)
MODE_CLEAN=$(echo "$MODE" | tr -d '[:space:]' | sed 's/#.*//')
if [[ "$MODE_CLEAN" == "strict" ]]; then
    echo "  ✅ PASS: Got mode=strict from default policy"
    PASS=$((PASS + 1))
else
    echo "  ❌ FAIL: Expected mode=strict, got: '${MODE_CLEAN}'"
    FAIL=$((FAIL + 1))
fi

echo ""

# Test 5: Permissive mode changes behavior
echo "Test 5: Permissive mode behavior"
PERMISSIVE_POLICY=$(mktemp /tmp/hexos-test-permissive-XXXXXX.yaml)
cat > "$PERMISSIVE_POLICY" <<EOF
scan:
  mode: permissive
  extensions: [.md, .js, .sh, .yaml, .json, .txt]
  exclude: [node_modules/, .git/]
  risk_levels:
    critical: fail
    high: fail
    medium: warn
    low: pass
EOF

# Scan malicious skill with permissive policy — should warn (exit 2) not fail (exit 1)
RESULT=$("${SECURITY_DIR}/scanner.sh" "skill" "${SCRIPT_DIR}/fixtures/malicious-skill" "$PERMISSIVE_POLICY" 2>/dev/null)
EXIT_CODE=$?
test_result "Permissive mode returns warn instead of fail" "2" "$EXIT_CODE"

# Verify action is "warn" not "fail"
ACTION=$(echo "$RESULT" | grep -o '"action":"[^"]*"' | cut -d'"' -f4)
test_result "Action is warn in permissive mode" "warn" "$ACTION"

rm -f "$PERMISSIVE_POLICY"

echo ""

# Test 6: Empty file validation
echo "Test 6: Empty file validation"
EMPTY_POLICY=$(mktemp /tmp/hexos-test-empty-XXXXXX.yaml)
"${SECURITY_DIR}/policy-loader.sh" validate "$EMPTY_POLICY" >/dev/null 2>&1
test_result "Empty policy file rejected" "1" "$?"
rm -f "$EMPTY_POLICY"

echo ""
echo "═══ Results: ${PASS} passed, ${FAIL} failed ═══"
exit $FAIL
