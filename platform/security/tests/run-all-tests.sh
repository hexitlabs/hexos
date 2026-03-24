#!/usr/bin/env bash
# HexOS Phase 1.5 — Run All Security Tests
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

TOTAL_PASS=0
TOTAL_FAIL=0

echo "╔══════════════════════════════════════════════════╗"
echo "║  HexOS Security Scanner — Test Suite             ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

run_test() {
    local test_name="$1"
    local test_script="$2"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Running: ${test_name}"
    echo ""
    bash "$test_script"
    local exit_code=$?
    if [[ $exit_code -eq 0 ]]; then
        TOTAL_PASS=$((TOTAL_PASS + 1))
    else
        TOTAL_FAIL=$((TOTAL_FAIL + 1))
    fi
    echo ""
}

run_test "Skill Scanner Tests" "${SCRIPT_DIR}/test-scan-skill.sh"
run_test "Exec Scanner Tests" "${SCRIPT_DIR}/test-scan-exec.sh"
run_test "Workspace Scanner Tests" "${SCRIPT_DIR}/test-scan-workspace.sh"
run_test "Policy Engine Tests" "${SCRIPT_DIR}/test-policy.sh"
run_test "Performance Tests" "${SCRIPT_DIR}/test-performance.sh"

echo "╔══════════════════════════════════════════════════╗"
echo "║  Final Results                                    ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
echo "  Test Suites Passed: ${TOTAL_PASS}"
echo "  Test Suites Failed: ${TOTAL_FAIL}"
echo ""

if [[ $TOTAL_FAIL -eq 0 ]]; then
    echo "  ✅ All test suites passed!"
else
    echo "  ❌ ${TOTAL_FAIL} test suite(s) had failures"
fi

exit $TOTAL_FAIL
