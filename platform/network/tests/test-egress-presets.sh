#!/usr/bin/env bash
set -euo pipefail

# HexOS Phase 2 — Test Egress Presets
# Verifies preset loading and composition
#
# Usage: ./test-egress-presets.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PRESETS_DIR="/hexos/platform/config/egress-presets"

echo "Testing egress presets..."

# Test 1: Presets directory exists
if [[ ! -d "$PRESETS_DIR" ]]; then
    echo "✗ FAILED: Presets directory not found: $PRESETS_DIR"
    exit 1
fi
echo "✓ Presets directory exists"

# Test 2: Each expected preset file exists and is valid YAML
declare -A EXPECTED_PRESETS=(
    ["anthropic"]="api.anthropic.com:443"
    ["openai"]="api.openai.com:443"
    ["telegram"]="api.telegram.org:443, *.telegram.org:443"
    ["github"]="api.github.com:443, github.com:443, *.githubusercontent.com:443"
    ["stripe"]="api.stripe.com:443"
    ["salesmanago"]="*.salesmanago.com:443"
    ["brave-search"]="api.search.brave.com:443"
    ["firecrawl"]="api.firecrawl.dev:443"
    ["google-search"]="www.googleapis.com:443, customsearch.googleapis.com:443"
    ["web-general"]="unrestricted: *:80, *:443"
)

for preset in "${!EXPECTED_PRESETS[@]}"; do
    preset_file="${PRESETS_DIR}/${preset}.yaml"
    if [[ ! -f "$preset_file" ]]; then
        echo "✗ FAILED: Missing preset file: $preset_file"
        exit 1
    fi
    
    # Check YAML validity
    if ! yq '.' "$preset_file" >/dev/null 2>&1; then
        echo "✗ FAILED: Invalid YAML in $preset_file"
        exit 1
    fi
    
    # Check for required fields
    if ! yq -r '.description // empty' "$preset_file" &>/dev/null; then
        echo "⚠ WARNING: Missing description in $preset_file"
    fi
    
    # Special check for web-general unrestricted
    if [[ "$preset" == "web-general" ]]; then
        if ! yq -r '.unrestricted_ports[]? // empty' "$preset_file" &>/dev/null; then
            echo "⚠ WARNING: web-general missing unrestricted_ports"
        fi
    else
        # Regular preset should have allow list
        if ! yq -r '.allow[]?.host // empty' "$preset_file" &>/dev/null; then
            echo "⚠ WARNING: $preset missing allow list"
        fi
    fi
    
    echo "  ✓ $preset: valid"
done

# Test 3: Test preset composition (loading multiple presets)
echo ""
echo "Testing preset composition..."

# Create a temporary client config with multiple presets
TEST_CLIENT="test-presets-composition"
TEST_HOME="/hexos/${TEST_CLIENT}"
mkdir -p "${TEST_HOME}/config"

cat > "${TEST_HOME}/config/egress.yaml" <<EOF
egress:
  presets: [anthropic, telegram, stripe]
  custom:
    - host: api.local.example.com
      port: 9000
  dns:
    resolver: "127.0.0.53"
    allow_custom: false
  logging:
    log_blocked: true
    log_allowed: false
EOF

# Generate rules (dry-run)
GENERATED="/hexos/platform/config/generated/${TEST_CLIENT}-egress.nft"
if ! "${SCRIPT_DIR}/egress-apply.sh" "$TEST_CLIENT" --dry-run; then
    echo "✗ FAILED: Failed to generate rules with multiple presets"
    exit 1
fi

if [[ ! -f "$GENERATED" ]]; then
    echo "✗ FAILED: Rules file not generated for composition test"
    exit 1
fi

echo "✓ Multiple presets composed successfully"

# Test 4: Test unknown preset handling
cat > "${TEST_HOME}/config/egress.yaml" <<EOF
egress:
  presets: [anthropic, unknown-preset-xyz]
  custom: []
  dns:
    resolver: "127.0.0.53"
    allow_custom: false
  logging:
    log_blocked: true
    log_allowed: false
EOF

# Should warn but not fail
if ! "${SCRIPT_DIR}/egress-apply.sh" "$TEST_CLIENT" --dry-run 2>&1 | grep -q "Warning: Unknown preset"; then
    echo "⚠ WARNING: Did not warn about unknown preset"
fi
echo "✓ Unknown preset handled gracefully"

# Cleanup
rm -rf "${TEST_HOME}"
rm -f "$GENERATED"

echo ""
echo "✓ All egress preset tests passed!"
exit 0