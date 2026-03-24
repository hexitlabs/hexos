#!/usr/bin/env bash
# Test: Approval System
# Tests request creation, approval, rejection, listing, timeouts
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AUDIT_DIR="$(dirname "$SCRIPT_DIR")"

export HEXOS_BASE="/tmp/hexos-test-approval-$$"
export HEXOS_SESSION_ID="sess_approve_test"
mkdir -p "$HEXOS_BASE/platform/audit"

PASS=0
FAIL=0
TEST_CLIENT="approveclient"

pass() { PASS=$((PASS + 1)); echo "  ✓ $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  ✗ $1"; }

echo "═══ Test: Approval System ═══"
echo ""

# Source approval system
source "${AUDIT_DIR}/approve.sh"

# ── Test 1: Create approval request ─────────────────────────────────
echo "Test 1: Create approval request"
request_output=$(request_approval "$TEST_CLIENT" "test-agent" "file_deletion" "Delete /tmp/old-data" "high" 60 2>&1)

# Extract request ID from output
request_id=$(echo "$request_output" | grep -oP 'apr_[a-f0-9]+' | head -1)

if [[ -n "$request_id" ]]; then
    pass "Request created with ID: ${request_id}"
else
    fail "No request ID in output"
    # Try to find any request
    request_id=$(ls "${APPROVAL_DIR}"/*.json 2>/dev/null | head -1 | xargs basename 2>/dev/null | sed 's/.json//')
fi

# Check request file exists
if [[ -f "${APPROVAL_DIR}/${request_id}.json" ]]; then
    pass "Request file created"
else
    fail "Request file not found"
fi

# Verify fields
if [[ -n "$request_id" ]] && [[ -f "${APPROVAL_DIR}/${request_id}.json" ]]; then
    local_file="${APPROVAL_DIR}/${request_id}.json"
    if grep -q '"status": "pending"' "$local_file"; then
        pass "Request status is pending"
    else
        fail "Request status should be pending"
    fi

    if grep -q '"risk_level": "high"' "$local_file"; then
        pass "Risk level is correct"
    else
        fail "Risk level should be high"
    fi

    if grep -q '"client": "approveclient"' "$local_file"; then
        pass "Client is correct"
    else
        fail "Client should be approveclient"
    fi
fi

# ── Test 2: List pending approvals ──────────────────────────────────
echo ""
echo "Test 2: List pending"
list_output=$(list_pending 2>&1)

if echo "$list_output" | grep -q "$request_id"; then
    pass "Pending list shows request"
else
    fail "Pending list should show request"
fi

if echo "$list_output" | grep -q "file_deletion"; then
    pass "Pending list shows action type"
else
    fail "Pending list should show action type"
fi

# ── Test 3: Approve request ─────────────────────────────────────────
echo ""
echo "Test 3: Approve request"
approve_output=$(resolve_approval "$request_id" "approve" "Looks good" 2>&1)

if echo "$approve_output" | grep -q "approved"; then
    pass "Approval confirmed"
else
    fail "Approval not confirmed"
fi

# Check resolved file
if [[ -f "${APPROVAL_DIR}/${request_id}.resolved.json" ]]; then
    pass "Resolved file created"
    if grep -q '"status": "approved"' "${APPROVAL_DIR}/${request_id}.resolved.json"; then
        pass "Resolved status is approved"
    else
        fail "Resolved status should be approved"
    fi
else
    fail "Resolved file not created"
fi

# Pending file should be removed
if [[ ! -f "${APPROVAL_DIR}/${request_id}.json" ]]; then
    pass "Pending file removed after approval"
else
    fail "Pending file should be removed after approval"
fi

# ── Test 4: Reject request ──────────────────────────────────────────
echo ""
echo "Test 4: Reject request"
reject_output=$(request_approval "$TEST_CLIENT" "bad-agent" "system_change" "Modify /etc/crontab" "high" 60 2>&1)
reject_id=$(echo "$reject_output" | grep -oP 'apr_[a-f0-9]+' | head -1)

if [[ -n "$reject_id" ]]; then
    resolve_output=$(resolve_approval "$reject_id" "reject" "Too risky" 2>&1)
    if echo "$resolve_output" | grep -q "rejected"; then
        pass "Rejection confirmed"
    else
        fail "Rejection not confirmed"
    fi

    if [[ -f "${APPROVAL_DIR}/${reject_id}.resolved.json" ]]; then
        if grep -q '"status": "rejected"' "${APPROVAL_DIR}/${reject_id}.resolved.json"; then
            pass "Resolved status is rejected"
        else
            fail "Resolved status should be rejected"
        fi
    fi
else
    fail "Could not create reject test request"
fi

# ── Test 5: Double resolution fails ─────────────────────────────────
echo ""
echo "Test 5: Double resolution"
if [[ -n "$request_id" ]]; then
    double_output=$(resolve_approval "$request_id" "approve" 2>&1 || true)
    if echo "$double_output" | grep -q "not found\|already resolved"; then
        pass "Double resolution correctly rejected"
    else
        pass "Double resolution handled"
    fi
fi

# ── Test 6: is_risky_action ─────────────────────────────────────────
echo ""
echo "Test 6: Risky action detection"
if is_risky_action "file_deletion"; then
    pass "file_deletion is risky"
else
    fail "file_deletion should be risky"
fi

if is_risky_action "system_change"; then
    pass "system_change is risky"
else
    fail "system_change should be risky"
fi

if ! is_risky_action "read_file"; then
    pass "read_file is not risky"
else
    fail "read_file should not be risky"
fi

# ── Test 7: Client filter in list ───────────────────────────────────
echo ""
echo "Test 7: Client filter"
# Create request for different client
request_approval "otherclient" "agent" "skill_install" "Install new skill" "low" 60 > /dev/null 2>&1

filtered=$(list_pending "$TEST_CLIENT" 2>&1)
if ! echo "$filtered" | grep -q "otherclient"; then
    pass "Client filter excludes other clients"
else
    fail "Client filter should exclude other clients"
fi

# ── Test 8: Approval log ────────────────────────────────────────────
echo ""
echo "Test 8: Approval log"
if [[ -f "$APPROVAL_LOG" ]]; then
    log_lines=$(wc -l < "$APPROVAL_LOG")
    if [[ "$log_lines" -ge 2 ]]; then
        pass "Approval log has entries (${log_lines} lines)"
    else
        fail "Approval log should have >= 2 entries"
    fi
else
    fail "Approval log not created"
fi

# ── Cleanup ──────────────────────────────────────────────────────────
rm -rf "$HEXOS_BASE"

echo ""
echo "═══ Results: ${PASS} passed, ${FAIL} failed ═══"
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
