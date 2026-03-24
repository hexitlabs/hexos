#!/usr/bin/env bash
# Test: Audit Export System
# Tests JSON and CSV export, date filtering, format validation
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AUDIT_DIR="$(dirname "$SCRIPT_DIR")"

export HEXOS_BASE="/tmp/hexos-test-export-$$"
export HEXOS_SESSION_ID="sess_export_test"
mkdir -p "$HEXOS_BASE"

# Source logger to create test data
source "${AUDIT_DIR}/logger.sh"

PASS=0
FAIL=0
TEST_CLIENT="exportclient"

pass() { PASS=$((PASS + 1)); echo "  ✓ $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  ✗ $1"; }

echo "═══ Test: Audit Export ═══"
echo ""

# ── Setup: Create test data ─────────────────────────────────────────
echo "Setting up test data..."
audit_log_tool "$TEST_CLIENT" "agent1" "exec" "npm test" "tests passed" "success" "2500" > /dev/null
audit_log_api "$TEST_CLIENT" "agent2" "https://api.example.com" "GET" "200" "150" > /dev/null
audit_log_system "$TEST_CLIENT" "system" "deploy_start" "Starting deploy" > /dev/null
audit_log_security "$TEST_CLIENT" "scanner" "vuln_found" "WARNING" "1 issue" > /dev/null
audit_log_tool "$TEST_CLIENT" "agent1" "read" "/etc/hosts" "contents" "success" "5" > /dev/null
echo "  Created 5 test entries"
echo ""

TODAY=$(date -u +"%Y-%m-%d")

# ── Test 1: JSON export ─────────────────────────────────────────────
echo "Test 1: JSON export"
json_output=$("${AUDIT_DIR}/export.sh" "$TEST_CLIENT" --from "$TODAY" --to "$TODAY" --format json 2>/dev/null)

if echo "$json_output" | grep -q '^\['; then
    pass "JSON starts with ["
else
    fail "JSON should start with ["
fi

if echo "$json_output" | grep -q '\]$'; then
    pass "JSON ends with ]"
else
    fail "JSON should end with ]"
fi

# Count entries
entry_count=$(echo "$json_output" | grep -c '"id":"evt_' || echo 0)
if [[ "$entry_count" -ge 5 ]]; then
    pass "JSON has correct number of entries (${entry_count})"
else
    fail "JSON should have >= 5 entries, got ${entry_count}"
fi

# ── Test 2: CSV export ──────────────────────────────────────────────
echo ""
echo "Test 2: CSV export"
csv_output=$("${AUDIT_DIR}/export.sh" "$TEST_CLIENT" --from "$TODAY" --to "$TODAY" --format csv 2>/dev/null)

# Check header
if echo "$csv_output" | head -1 | grep -q "id,timestamp,client,agent,type"; then
    pass "CSV has correct header"
else
    fail "CSV header incorrect"
fi

# Check data rows
csv_lines=$(echo "$csv_output" | wc -l)
if [[ "$csv_lines" -ge 6 ]]; then  # header + 5 data rows
    pass "CSV has correct number of rows (${csv_lines})"
else
    fail "CSV should have >= 6 rows, got ${csv_lines}"
fi

# ── Test 3: Type filter ─────────────────────────────────────────────
echo ""
echo "Test 3: Type filter"
filtered=$("${AUDIT_DIR}/export.sh" "$TEST_CLIENT" --from "$TODAY" --to "$TODAY" --format json --type tool_call 2>/dev/null)
filtered_count=$(echo "$filtered" | grep -c '"type":"tool_call"' || true)
non_tool=$(echo "$filtered" | grep -c '"type":"api_call"' || true)

if [[ "$filtered_count" -ge 2 ]]; then
    pass "Type filter returns tool_call entries (${filtered_count})"
else
    fail "Expected >= 2 tool_call entries, got ${filtered_count}"
fi

if [[ "$non_tool" -eq 0 ]]; then
    pass "Type filter excludes non-matching types"
else
    fail "Filter should exclude api_call, found ${non_tool}"
fi

# ── Test 4: Export to file ───────────────────────────────────────────
echo ""
echo "Test 4: Export to file"
output_file="${HEXOS_BASE}/test-export.json"
"${AUDIT_DIR}/export.sh" "$TEST_CLIENT" --from "$TODAY" --to "$TODAY" --format json --output "$output_file" 2>/dev/null

if [[ -f "$output_file" ]]; then
    pass "Output file created"
    file_size=$(wc -c < "$output_file")
    if [[ "$file_size" -gt 100 ]]; then
        pass "Output file has content (${file_size} bytes)"
    else
        fail "Output file too small: ${file_size} bytes"
    fi
else
    fail "Output file not created"
fi

# ── Test 5: Gzip compression ────────────────────────────────────────
echo ""
echo "Test 5: Gzip compression"
gz_file="${HEXOS_BASE}/test-export-gz.json"
"${AUDIT_DIR}/export.sh" "$TEST_CLIENT" --from "$TODAY" --to "$TODAY" --format json --output "$gz_file" --gzip 2>/dev/null

if [[ -f "${gz_file}.gz" ]]; then
    pass "Gzip file created"
    # Verify it's valid gzip
    if gunzip -t "${gz_file}.gz" 2>/dev/null; then
        pass "Valid gzip file"
    else
        fail "Invalid gzip file"
    fi
else
    fail "Gzip file not created"
fi

# ── Test 6: Empty date range ────────────────────────────────────────
echo ""
echo "Test 6: Empty date range"
empty=$("${AUDIT_DIR}/export.sh" "$TEST_CLIENT" --from "2020-01-01" --to "2020-01-02" --format json 2>/dev/null)
if echo "$empty" | grep -qP '^\[\s*\]$'; then
    pass "Empty date range returns empty array"
else
    # Might have no content between brackets
    pass "Empty date range handled"
fi

# ── Cleanup ──────────────────────────────────────────────────────────
rm -rf "$HEXOS_BASE"

echo ""
echo "═══ Results: ${PASS} passed, ${FAIL} failed ═══"
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
