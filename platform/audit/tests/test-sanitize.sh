#!/usr/bin/env bash
# Test: Credential Sanitizer
# Tests all credential patterns, false positives, performance
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AUDIT_DIR="$(dirname "$SCRIPT_DIR")"

# Source sanitizer
source "${AUDIT_DIR}/sanitize.sh"

PASS=0
FAIL=0

pass() { PASS=$((PASS + 1)); echo "  ✓ $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  ✗ $1: got '$2'"; }

assert_redacted() {
    local desc="$1"
    local input="$2"
    local expected_marker="$3"
    local result
    result="$(sanitize_text "$input")"
    if echo "$result" | grep -q '\[REDACTED'; then
        if [[ -n "$expected_marker" ]] && echo "$result" | grep -q "$expected_marker"; then
            pass "$desc"
        elif [[ -z "$expected_marker" ]]; then
            pass "$desc"
        else
            fail "$desc — wrong marker" "$result"
        fi
    else
        fail "$desc — not redacted" "$result"
    fi
}

assert_clean() {
    local desc="$1"
    local input="$2"
    local result
    result="$(sanitize_text "$input")"
    if echo "$result" | grep -q '\[REDACTED'; then
        fail "$desc — false positive" "$result"
    else
        pass "$desc"
    fi
}

echo "═══ Test: Credential Sanitizer ═══"
echo ""

# ── API Keys ─────────────────────────────────────────────────────────
echo "API Keys:"
assert_redacted "OpenAI key (sk-...)" \
    "My key is sk-abc123def456ghi789jkl012mno345pqr678" \
    "[REDACTED:api_key]"

assert_redacted "Anthropic key (sk-ant-...)" \
    "ANTHROPIC_API_KEY=sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234567890" \
    "[REDACTED:api_key]"

assert_redacted "Generic key- prefix" \
    "Using key-abcdef1234567890abcdef1234" \
    "[REDACTED:api_key]"

assert_redacted "Generic token- prefix" \
    "Auth: token-abcdef1234567890abcdef1234" \
    "[REDACTED:api_key]"

# ── AWS Keys ─────────────────────────────────────────────────────────
echo ""
echo "AWS Keys:"
assert_redacted "AWS Access Key" \
    "aws_access_key_id = AKIAIOSFODNN7EXAMPLE" \
    "[REDACTED:aws_key]"

# ── GitHub Tokens ────────────────────────────────────────────────────
echo ""
echo "GitHub Tokens:"
assert_redacted "GitHub PAT (ghp_)" \
    "token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh" \
    "[REDACTED:github_token]"

assert_redacted "GitHub OAuth (gho_)" \
    "GITHUB_TOKEN=gho_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh" \
    "[REDACTED:github_token]"

# ── Bearer Tokens ────────────────────────────────────────────────────
echo ""
echo "Bearer Tokens:"
assert_redacted "Bearer token" \
    "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abcdef" \
    "[REDACTED"

# ── Passwords ────────────────────────────────────────────────────────
echo ""
echo "Passwords:"
assert_redacted "password= pattern" \
    "DB_CONFIG password=SuperSecret123!" \
    "[REDACTED:password]"

assert_redacted "passwd= pattern" \
    "mysql passwd=MyDBPass99" \
    "[REDACTED:password]"

# ── Connection Strings ───────────────────────────────────────────────
echo ""
echo "Connection Strings:"
assert_redacted "PostgreSQL connection" \
    "DATABASE_URL=postgres://admin:s3cretP@ss@db.example.com:5432/mydb" \
    "[REDACTED:credentials]"

assert_redacted "MySQL connection" \
    "mysql://root:password123@localhost/test" \
    "[REDACTED:credentials]"

assert_redacted "Redis connection" \
    "redis://default:myRedisPass@redis.example.com:6379" \
    "[REDACTED:credentials]"

# ── Slack Tokens ─────────────────────────────────────────────────────
echo ""
echo "Slack Tokens:"
assert_redacted "Slack bot token" \
    "SLACK_TOKEN=xoxb-123456789012-1234567890123-AbCdEfGhIjKlMnOpQrStUvWx" \
    "[REDACTED:slack_token]"

# ── Stripe Keys ─────────────────────────────────────────────────────
echo ""
echo "Stripe Keys:"
assert_redacted "Stripe secret key" \
    "stripe.api_key = sk_live_51H7bM2EZvKYlo2CpC7YGqWXabcdefghijklmnopqrstuv" \
    "[REDACTED:stripe_key]"

# ── JWTs ─────────────────────────────────────────────────────────────
echo ""
echo "JWTs:"
assert_redacted "JWT token" \
    "token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U" \
    "[REDACTED:jwt]"

# ── Private Keys ─────────────────────────────────────────────────────
echo ""
echo "Private Keys:"
assert_redacted "RSA Private Key" \
    "-----BEGIN RSA PRIVATE KEY-----MIIEowIBAAKCAQEAz-----END RSA PRIVATE KEY-----" \
    "[REDACTED:private_key]"

# ── Cookies ──────────────────────────────────────────────────────────
echo ""
echo "Headers:"
assert_redacted "Cookie header" \
    "Cookie: session_id=abc123; auth_token=xyz789" \
    "[REDACTED:cookies]"

# ── npm Tokens ───────────────────────────────────────────────────────
echo ""
echo "npm Tokens:"
assert_redacted "npm token" \
    "//registry.npmjs.org/:_authToken=npm_ABCDEFGHIJKLMNOPQRSTUVWXYZabc" \
    "[REDACTED:npm_token]"

# ── False Positive Tests ─────────────────────────────────────────────
echo ""
echo "False Positives (should NOT be redacted):"
assert_clean "Normal text" \
    "This is a normal log message about deploying the application"

assert_clean "Regular URL" \
    "Fetching https://api.github.com/repos/hexos/hexos/pulls"

assert_clean "File path" \
    "/hexos/clients/jirka/workspace/src/index.ts"

assert_clean "Normal numbers" \
    "Processed 12345 records in 456ms"

assert_clean "Short key-like words" \
    "The key to success is persistence"

assert_clean "Email address" \
    "Contact support@example.com for help"

assert_clean "Version strings" \
    "Updated to v2.1.0-beta.3"

# ── check_clean function ────────────────────────────────────────────
echo ""
echo "check_clean function:"
if check_clean "This is safe text"; then
    pass "check_clean returns 0 for clean text"
else
    fail "check_clean should return 0 for clean text" "returned 1"
fi

if ! check_clean "password=secret123"; then
    pass "check_clean returns 1 for dirty text"
else
    fail "check_clean should return 1 for dirty text" "returned 0"
fi

# ── Performance Test ─────────────────────────────────────────────────
echo ""
echo "Performance:"
start_time=$(date +%s%N)
for i in $(seq 1 100); do
    sanitize_text "Normal log line with some text endpoint=https://api.example.com status=200 duration_ms=50 agent=orchestrator" > /dev/null
done
end_time=$(date +%s%N)
elapsed_ms=$(( (end_time - start_time) / 1000000 ))
avg_ms=$((elapsed_ms / 100))

if [[ $avg_ms -le 5 ]]; then
    pass "Performance: ${avg_ms}ms avg per call (target: <5ms)"
else
    # Be lenient — CI environments can be slow
    if [[ $avg_ms -le 20 ]]; then
        pass "Performance: ${avg_ms}ms avg per call (acceptable, target: <5ms)"
    else
        fail "Performance too slow" "${avg_ms}ms avg (target: <5ms)"
    fi
fi

echo ""
echo "═══ Results: ${PASS} passed, ${FAIL} failed ═══"
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
