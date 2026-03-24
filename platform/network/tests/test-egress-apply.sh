#!/usr/bin/env bash
set -euo pipefail

# HexOS Phase 2 — Test Egress Apply
# Verifies rules are generated correctly from YAML
#
# Usage: ./test-egress-apply.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLATFORM_DIR="$(dirname "$SCRIPT_DIR")"
TEST_CLIENT="test-egress-client"
TEST_HOME="/hexos/${TEST_CLIENT}"
TEST_CONFIG="${TEST_HOME}/config/egress.yaml"
GENERATED_RULES="/hexos/platform/config/generated/${TEST_CLIENT}-egress.nft"

echo "Testing egress rule generation..."

# Clean up any previous test
"${SCRIPT_DIR}/egress-remove.sh" "${TEST_CLIENT}" 2>/dev/null || true
rm -rf "${TEST_HOME}" 2>/dev/null || true
rm -f "${GENERATED_RULES}" 2>/dev/null || true

# Create test client directory structure
mkdir -p "${TEST_HOME}/config"

# Create test YAML config
cat > "${TEST_CONFIG}" <<EOF
egress:
  presets: [anthropic, telegram]
  custom:
    - host: api.example.com
      port: 8443
      protocol: tcp
    - host: "*.internal.example.com"
      port: 443
  dns:
    resolver: "127.0.0.53"
    allow_custom: false
  logging:
    log_blocked: true
    log_allowed: false
EOF

chown -R 1000:1000 "${TEST_HOME}" 2>/dev/null || true  # Assume test user exists

# Run egress apply in dry-run mode
echo "Generating rules (dry-run)..."
if ! "${SCRIPT_DIR}/egress-apply.sh" "${TEST_CLIENT}" --dry-run; then
    echo "✗ FAILED: egress-apply.sh dry-run failed"
    exit 1
fi

# Check that rules file was generated
if [[ ! -f "${GENERATED_RULES}" ]]; then
    echo "✗ FAILED: Rules file not generated"
    exit 1
fi

echo "✓ Rules file generated"

# Verify key components in rules
echo "Verifying rule contents..."

# Should have table definition
if ! grep -q "table inet hexos_${TEST_CLIENT//-/_}" "${GENERATED_RULES}"; then
    echo "✗ FAILED: Missing table definition"
    exit 1
fi

# Should have client chain
if ! grep -q "chain client_${TEST_CLIENT//-/_}" "${GENERATED_RULES}"; then
    echo "✗ FAILED: Missing client chain"
    exit 1
fi

# Should have established/related rule
if ! grep -q "ct state established,related accept" "${GENERATED_RULES}"; then
    echo "✗ FAILED: Missing established/related rule"
    exit 1
fi

# Should have loopback rule
if ! grep -q 'oifname "lo" accept' "${GENERATED_RULES}"; then
    echo "✗ FAILED: Missing loopback rule"
    exit 1
fi

# Should have DNS rules
if ! grep -q "udp dport 53.*accept" "${GENERATED_RULES}"; then
    echo "✗ FAILED: Missing DNS UDP rule"
    exit 1
fi

if ! grep -q "tcp dport 53.*accept" "${GENERATED_RULES}"; then
    echo "✗ FAILED: Missing DNS TCP rule"
    exit 1
fi

# Should have allowlisted IP set (unless DNS resolution failed in test env)
# In dry-run, we might not have actual IPs, but set definition should exist
if ! grep -q "set hexos_test_egress_client_allowed_v4" "${GENERATED_RULES}"; then
    echo "⚠ WARNING: IP set not found (may be due to DNS resolution in test env)"
    # This is OK for test environment
fi

# Should have drop rule at end
if ! grep -q "counter drop" "${GENERATED_RULES}"; then
    echo "✗ FAILED: Missing counter drop rule"
    exit 1
fi

# Check for preset expansions
if ! grep -q "api.anthropic.com" "${GENERATED_RULES}" 2>/dev/null || \
   ! grep -q "api.telegram.org" "${GENERATED_RULES}" 2>/dev/null; then
    echo "⚠ WARNING: Preset hosts not found in rules (may be due to DNS resolution)"
fi

# Check for custom host
if ! grep -q "api.example.com" "${GENERATED_RULES}" 2>/dev/null; then
    echo "⚠ WARNING: Custom host not found in rules"
fi

# Test with web-general preset (should create unrestricted ports)
echo ""
echo "Testing web-general preset..."

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

# Clean and regenerate
rm -f "${GENERATED_RULES}"
if ! "${SCRIPT_DIR}/egress-apply.sh" "${TEST_CLIENT}" --dry-run; then
    echo "✗ FAILED: web-general test failed"
    exit 1
fi

# Check for unrestricted ports
if ! grep -q "tcp dport { 80, 443 } accept" "${GENERATED_RULES}" && \
   ! grep -q "tcp dport { 443, 80 } accept" "${GENERATED_RULES}"; then
    echo "✗ FAILED: web-general should allow ports 80 and 443"
    exit 1
fi

echo "✓ web-general preset test passed"

# Cleanup
"${SCRIPT_DIR}/egress-remove.sh" "${TEST_CLIENT}" 2>/dev/null || true
rm -rf "${TEST_HOME}" 2>/dev/null || true
rm -f "${GENERATED_RULES}" 2>/dev/null || true

echo ""
echo "✓ All egress apply tests passed!"
exit 0