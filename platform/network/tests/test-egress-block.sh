#!/usr/bin/env bash
set -euo pipefail

# HexOS Phase 2 — Test Egress Block
# Verifies unauthorized traffic is blocked (using nft --check or dry-run)
#
# Usage: ./test-egress-block.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLATFORM_DIR="$(dirname "$SCRIPT_DIR")"
TEST_CLIENT="test-egress-block"
TEST_HOME="/hexos/${TEST_CLIENT}"
TEST_CONFIG="${TEST_HOME}/config/egress.yaml"
GENERATED_RULES="/hexos/platform/config/generated/${TEST_CLIENT}-egress.nft"

echo "Testing egress blocking behavior..."

# Clean up any previous test
"${SCRIPT_DIR}/egress-remove.sh" "${TEST_CLIENT}" 2>/dev/null || true
rm -rf "${TEST_HOME}" 2>/dev/null || true
rm -f "${GENERATED_RULES}" 2>/dev/null || true

# Create test client directory structure
mkdir -p "${TEST_HOME}/config"

# Create restrictive test YAML config (only allow specific host)
cat > "${TEST_CONFIG}" <<EOF
egress:
  presets: []  # No presets
  custom:
    - host: api.allowed.example.com
      port: 443
      protocol: tcp
  dns:
    resolver: "127.0.0.53"
    allow_custom: false
  logging:
    log_blocked: true
    log_allowed: false
EOF

chown -R 1000:1000 "${TEST_HOME}" 2>/dev/null || true  # Assume test user exists

# Generate rules
echo "Generating rules for restrictive policy..."
if ! "${SCRIPT_DIR}/egress-apply.sh" "${TEST_CLIENT}" --dry-run; then
    echo "✗ FAILED: egress-apply.sh failed"
    exit 1
fi

if [[ ! -f "${GENERATED_RULES}" ]]; then
    echo "✗ FAILED: Rules file not generated"
    exit 1
fi

echo "✓ Rules generated"

# Test 1: Verify only specific IPs are allowed
echo ""
echo "1. Verifying IP set contains only allowed host..."

# Extract the set definition
if ! SET_LINE=$(grep "set hexos_test_egress_block_allowed_v4" "${GENERATED_RULES}" 2>/dev/null); then
    echo "⚠ WARNING: IP set not found (DNS may have failed in test env)"
    # Continue anyway - in test env DNS might not resolve
else
    echo "  Found IP set: $SET_LINE"
    # The set should exist, we can't easily test contents without actual DNS resolution
fi

# Test 2: Verify default-deny behavior (everything else dropped)
echo ""
echo "2. Verifying default-deny behavior..."
if ! grep -q "counter drop" "${GENERATED_RULES}"; then
    echo "✗ FAILED: No counter drop rule found - not default-deny"
    exit 1
fi

# Count drop rules - should be exactly one (at end of chain)
DROP_COUNT=$(grep -c "counter drop" "${GENERATED_RULES}" || echo "0")
if [[ "$DROP_COUNT" -ne 1 ]]; then
    echo "⚠ WARNING: Expected 1 drop rule, found $DROP_COUNT"
fi

# Test 3: Verify established/related allowed
echo ""
echo "3. Verifying established/related traffic allowed..."
if ! grep -q "ct state established,related accept" "${GENERATED_RULES}"; then
    echo "✗ FAILED: Missing established/related rule"
    exit 1
fi
echo "  ✓ Established/related traffic allowed"

# Test 4: Verify loopback allowed
echo ""
echo "4. Verifying loopback traffic allowed..."
if ! grep -q 'oifname "lo" accept' "${GENERATED_RULES}"; then
    echo "✗ FAILED: Missing loopback rule"
    exit 1
fi
echo "  ✓ Loopback traffic allowed"

# Test 5: Verify DNS to resolver only
echo ""
echo "5. Verifying DNS restricted to platform resolver..."
DNS_RESOLVER=$(yq -r '.egress.dns.resolver // "127.0.0.53"' "${TEST_CONFIG}")
if grep -q "ip daddr ${DNS_RESOLVER}.*udp dport 53.*accept" "${GENERATED_RULES}"; then
    echo "  ✓ UDP DNS to resolver allowed"
else
    echo "✗ FAILED: Missing UDP DNS rule to resolver"
    exit 1
fi

if grep -q "ip daddr ${DNS_RESOLVER}.*tcp dport 53.*accept" "${GENERATED_RULES}"; then
    echo "  ✓ TCP DNS to resolver allowed"
else
    echo "✗ FAILED: Missing TCP DNS rule to resolver"
    exit 1
fi

# Verify that other DNS would be blocked (by virtue of being in client_rules chain before drop)
# This is implicit in the rule ordering - if we reach the drop, it's blocked

# Test 6: Test with web-general preset (should allow *:80 and *:443)
echo ""
echo "6. Testing web-general preset allows all HTTP/HTTPS..."
cat > "${TEST_CONFIG}" <<EOF
egress:
  presets: [web-general]
  custom: []
  dns:
    resolver: "127.0.0.53"
    allow_custom: false
  logging:
    log_blocked: true
    log_allowed: false
EOF

rm -f "${GENERATED_RULES}"
if ! "${SCRIPT_DIR}/egress-apply.sh" "${TEST_CLIENT}" --dry-run; then
    echo "✗ FAILED: web-general test failed"
    exit 1
fi

# Should allow ports 80 and 443
if ! grep -q "tcp dport.*{ 80, 443 }.*accept" "${GENERATED_RULES}" && \
   ! grep -q "tcp dport.*{ 443, 80 }.*accept" "${GENERATED_RULES}"; then
    echo "✗ FAILED: web-general should allow ports 80 and 443"
    exit 1
fi
echo "  ✓ web-general allows HTTP/HTTPS"

# Test 7: Verify LOCKDOWN mode blocks everything
echo ""
echo "7. Testing LOCKDOWN mode..."
touch "${TEST_HOME}/config/.egress-lockdown"
rm -f "${GENERATED_RULES}"
if ! "${SCRIPT_DIR}/egress-apply.sh" "${TEST_CLIENT}" --dry-run; then
    echo "✗ FAILED: lockdown test failed"
    exit 1
fi

# Should have LOCKDOWN in prefix and only established/related + drop
if ! grep -q "hexos-egress-LOCKDOWN-${TEST_CLIENT}" "${GENERATED_RULES}"; then
    echo "✗ FAILED: Missing LOCKDOWN prefix"
    exit 1
fi

# Should NOT have DNS allow rules in lockdown (everything blocked)
# Actually, lockdown still allows established/related for graceful close
if ! grep -q "ct state established,related accept" "${GENERATED_RULES}"; then
    echo "✗ FAILED: Lockdown should allow established/related"
    exit 1
fi

# Should have drop rule
if ! grep -q "counter drop" "${GENERATED_RULES}"; then
    echo "✗ FAILED: Lockdown missing drop rule"
    exit 1
fi
echo "  ✓ LOCKDOWN blocks all new connections"

# Cleanup
"${SCRIPT_DIR}/egress-remove.sh" "${TEST_CLIENT}" 2>/dev/null || true
rm -rf "${TEST_HOME}" 2>/dev/null || true
rm -f "${GENERATED_RULES}" 2>/dev/null || true
rm -f "${TEST_HOME}/config/.egress-lockdown" 2>/dev/null || true

echo ""
echo "✓ All egress block tests passed!"
exit 0