#!/usr/bin/env bash
# HexOS Phase 6 — Run All Audit Tests
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

TOTAL_PASS=0
TOTAL_FAIL=0
TESTS_RUN=0
TESTS_FAILED=0

echo "╔══════════════════════════════════════════════════╗"
echo "║  HexOS Phase 6: Audit Trail Test Suite            ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

for test_file in "${SCRIPT_DIR}"/test-*.sh; do
    [[ -f "$test_file" ]] || continue
    test_name=$(basename "$test_file" .sh)
    TESTS_RUN=$((TESTS_RUN + 1))

    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Running: ${test_name}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    if bash "$test_file"; then
        echo "→ ${test_name}: PASSED"
    else
        echo "→ ${test_name}: FAILED"
        TESTS_FAILED=$((TESTS_FAILED + 1))
    fi
    echo ""
done

echo "════════════════════════════════════════════════════"
echo ""
echo "  Tests run:    ${TESTS_RUN}"
echo "  Tests passed: $((TESTS_RUN - TESTS_FAILED))"
echo "  Tests failed: ${TESTS_FAILED}"
echo ""

if [[ $TESTS_FAILED -eq 0 ]]; then
    echo "  ✅ All tests passed!"
    exit 0
else
    echo "  ❌ ${TESTS_FAILED} test(s) failed"
    exit 1
fi
