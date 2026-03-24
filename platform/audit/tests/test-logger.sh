#!/usr/bin/env bash
# Test: Audit Logger
# Tests JSONL logging, daily rotation, hash chaining, event types
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AUDIT_DIR="$(dirname "$SCRIPT_DIR")"

# Use temp directory for testing
export HEXOS_BASE="/tmp/hexos-test-$$"
export HEXOS_SESSION_ID="sess_test123"
mkdir -p "$HEXOS_BASE"

# Source logger
source "${AUDIT_DIR}/logger.sh"

PASS=0
FAIL=0
TEST_CLIENT="testclient"

pass() { PASS=$((PASS + 1)); echo "  ✓ $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  ✗ $1"; }

echo "═══ Test: Audit Logger ═══"
echo ""

# ── Test 1: Basic logging creates JSONL file ────────────────────────
echo "Test 1: Basic logging"
event_id=$(audit_log "$TEST_CLIENT" "tool_call" "test-agent" "tool=exec" "input=ls" "status=success")
log_file="${HEXOS_BASE}/${TEST_CLIENT}/audit/$(date -u +"%Y-%m-%d").jsonl"

if [[ -f "$log_file" ]]; then
    pass "Log file created"
else
    fail "Log file not created at $log_file"
fi

# ── Test 2: JSONL format validation ─────────────────────────────────
echo "Test 2: JSONL format"
last_line=$(tail -1 "$log_file")

# Check it's valid JSON (basic check)
if echo "$last_line" | grep -qP '^\{.*\}$'; then
    pass "Entry is JSON object"
else
    fail "Entry is not valid JSON: $last_line"
fi

# Check required fields
for field in id ts client agent type session prev_hash; do
    if echo "$last_line" | grep -q "\"${field}\":"; then
        pass "Has field: ${field}"
    else
        fail "Missing field: ${field}"
    fi
done

# ── Test 3: Event ID format ─────────────────────────────────────────
echo "Test 3: Event ID format"
if echo "$last_line" | grep -qP '"id":"evt_[a-f0-9]{12}"'; then
    pass "Event ID has correct format (evt_*)"
else
    fail "Event ID format incorrect"
fi

# ── Test 4: Session ID ──────────────────────────────────────────────
echo "Test 4: Session ID"
if echo "$last_line" | grep -q '"session":"sess_test123"'; then
    pass "Session ID passed through"
else
    fail "Session ID not found"
fi

# ── Test 5: Multiple entries + hash chaining ────────────────────────
echo "Test 5: Hash chaining"
audit_log "$TEST_CLIENT" "api_call" "web-agent" "endpoint=https://api.test.com" "method=GET" > /dev/null
audit_log "$TEST_CLIENT" "system_event" "system" "event=test" > /dev/null

line_count=$(wc -l < "$log_file")
if [[ "$line_count" -ge 3 ]]; then
    pass "Multiple entries logged (${line_count} lines)"
else
    fail "Expected >= 3 entries, got ${line_count}"
fi

# Verify chain
chain_result=$(audit_verify_chain "$TEST_CLIENT")
if echo "$chain_result" | grep -q "CHAIN VALID"; then
    pass "Hash chain is valid"
else
    fail "Hash chain verification failed: $chain_result"
fi

# ── Test 6: Convenience wrappers ────────────────────────────────────
echo "Test 6: Convenience wrappers"
audit_log_tool "$TEST_CLIENT" "agent1" "exec" "npm install" "success output" "success" "500" > /dev/null
audit_log_api "$TEST_CLIENT" "agent2" "https://api.example.com" "POST" "201" "120" > /dev/null
audit_log_system "$TEST_CLIENT" "system" "agent_started" "Agent orchestrator started" > /dev/null
audit_log_security "$TEST_CLIENT" "scanner" "scan_complete" "WARNING" "3 issues found" > /dev/null

line_count=$(wc -l < "$log_file")
if [[ "$line_count" -ge 7 ]]; then
    pass "All convenience wrappers logged (${line_count} total)"
else
    fail "Expected >= 7 entries, got ${line_count}"
fi

# ── Test 7: Event count ─────────────────────────────────────────────
echo "Test 7: Event count helper"
count=$(audit_count "$TEST_CLIENT")
if [[ "$count" -ge 7 ]]; then
    pass "audit_count returns correct count: ${count}"
else
    fail "audit_count returned ${count}, expected >= 7"
fi

# ── Test 8: Log path helper ─────────────────────────────────────────
echo "Test 8: Log path helper"
path=$(audit_log_path "$TEST_CLIENT")
if [[ "$path" == "$log_file" ]]; then
    pass "audit_log_path returns correct path"
else
    fail "audit_log_path returned wrong path: $path (expected $log_file)"
fi

# ── Test 9: Output truncation ───────────────────────────────────────
echo "Test 9: Output truncation"
long_output=$(python3 -c "print('x' * 2000)" 2>/dev/null || printf '%2000s' ' ' | tr ' ' 'x')
audit_log_tool "$TEST_CLIENT" "agent" "exec" "test" "$long_output" "success" "100" > /dev/null
last_entry=$(tail -1 "$log_file")
output_val=$(echo "$last_entry" | grep -oP '"output":"[^"]*"' | head -1 | cut -d'"' -f4)
if [[ ${#output_val} -le 1010 ]]; then
    pass "Long output truncated (${#output_val} chars)"
else
    fail "Output not truncated: ${#output_val} chars"
fi

# ── Cleanup ──────────────────────────────────────────────────────────
rm -rf "$HEXOS_BASE"

echo ""
echo "═══ Results: ${PASS} passed, ${FAIL} failed ═══"
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
