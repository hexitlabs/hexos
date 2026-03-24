#!/usr/bin/env bash
# HexOS Phase 6 — Credential Sanitizer
# Strips secrets from any text before logging
#
# Usage:
#   source sanitize.sh
#   sanitize_text "my api key is sk-abc123def456ghi789"
#   echo "Bearer eyJ..." | sanitize_stdin
#
# Performance target: <5ms per call
set -uo pipefail

# ── Pattern Definitions ──────────────────────────────────────────────
# Each pattern: sed expression for fast replacement
# Order matters — more specific patterns first

# Build the sed script once (compiled at source time for performance)
_SANITIZE_SED_SCRIPT=""

_build_sanitize_script() {
    local patterns=()

    # Private keys (multi-line aware — single line version)
    patterns+=('s/-----BEGIN [A-Z ]*PRIVATE KEY-----[^-]*-----END [A-Z ]*PRIVATE KEY-----/[REDACTED:private_key]/g')

    # AWS Access Keys (AKIA followed by 16 alphanumeric)
    patterns+=('s/AKIA[0-9A-Z]\{16\}/[REDACTED:aws_key]/g')

    # GitHub tokens (ghp_, gho_, ghu_, ghs_, ghr_ followed by 36 chars)
    patterns+=('s/\(ghp_\|gho_\|ghu_\|ghs_\|ghr_\)[a-zA-Z0-9]\{36\}/[REDACTED:github_token]/g')

    # OpenAI / Anthropic API keys (sk-... with 20+ chars)
    patterns+=('s/sk-[a-zA-Z0-9_-]\{20,\}/[REDACTED:api_key]/g')

    # Generic API key patterns: key-*, token-* with 20+ chars
    patterns+=('s/\(key-\|token-\)[a-zA-Z0-9_-]\{20,\}/[REDACTED:api_key]/g')

    # Bearer tokens
    patterns+=('s/Bearer [a-zA-Z0-9_\.\-]\{20,\}/Bearer [REDACTED:bearer_token]/g')

    # Authorization headers
    patterns+=('s/\(Authorization:\s*\)\(Basic\|Bearer\|Token\)\s\+[^ ]*/\1\2 [REDACTED:auth_header]/gI')

    # Password patterns: password=..., passwd=..., pwd=...
    patterns+=('s/\(password\|passwd\|pwd\)\(=\|: *\|:\)\([^ "&'\'']\{1,\}\)/\1\2[REDACTED:password]/gI')

    # Connection strings: protocol://user:pass@host
    patterns+=('s|\([a-zA-Z]\{3,10\}://\)[^:]*:[^@]*@|\1[REDACTED:credentials]@|g')

    # Slack tokens (xoxb-, xoxp-, xoxs-, xoxa-)
    patterns+=('s/xox[bpsa]-[a-zA-Z0-9-]\{20,\}/[REDACTED:slack_token]/g')

    # npm tokens
    patterns+=('s/npm_[a-zA-Z0-9]\{20,\}/[REDACTED:npm_token]/g')

    # Stripe keys (sk_live_, sk_test_, pk_live_, pk_test_)
    patterns+=('s/\(sk_live_\|sk_test_\|pk_live_\|pk_test_\)[a-zA-Z0-9]\{20,\}/[REDACTED:stripe_key]/g')

    # Hex tokens (32+ chars of hex, common in API keys)
    # Be careful — only match when preceded by common key indicators
    patterns+=('s/\(api[_-]\?key\|secret\|token\|apikey\)\(=\|: *\|:\)\([0-9a-fA-F]\{32,\}\)/\1\2[REDACTED:hex_key]/gI')

    # JSON Web Tokens (eyJ...)
    patterns+=('s/eyJ[a-zA-Z0-9_-]*\.eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*/[REDACTED:jwt]/g')

    # Cookie values in headers
    patterns+=('s/\(Cookie:\s*\)[^\r\n]*/\1[REDACTED:cookies]/gI')
    patterns+=('s/\(Set-Cookie:\s*\)[^\r\n]*/\1[REDACTED:cookies]/gI')

    # Build combined sed script
    _SANITIZE_SED_SCRIPT=""
    for p in "${patterns[@]}"; do
        _SANITIZE_SED_SCRIPT="${_SANITIZE_SED_SCRIPT}${p};"
    done
}

# Build on source
_build_sanitize_script

# ── Public Functions ─────────────────────────────────────────────────

# Sanitize a string argument
# Returns sanitized text on stdout
sanitize_text() {
    local text="$1"
    if [[ -z "$text" ]]; then
        echo ""
        return 0
    fi
    echo "$text" | sed "${_SANITIZE_SED_SCRIPT}"
}

# Sanitize from stdin (pipe-friendly)
sanitize_stdin() {
    sed "${_SANITIZE_SED_SCRIPT}"
}

# Sanitize a file in place (creates .bak)
sanitize_file() {
    local file="${1:?File path required}"
    if [[ ! -f "$file" ]]; then
        echo "File not found: $file" >&2
        return 1
    fi
    sed -i.bak "${_SANITIZE_SED_SCRIPT}" "$file"
}

# Check if text contains any credentials (returns 0 if clean, 1 if dirty)
check_clean() {
    local text="$1"
    local sanitized
    sanitized="$(sanitize_text "$text")"
    if [[ "$sanitized" == "$text" ]]; then
        return 0  # Clean
    else
        return 1  # Had credentials
    fi
}

# Load custom patterns from client config
# Expects YAML with sanitize_patterns list of regex patterns
load_custom_patterns() {
    local config_file="${1:?Config file required}"
    if [[ ! -f "$config_file" ]]; then
        return 0
    fi

    # Extract custom patterns (simple YAML parsing)
    local custom_patterns
    custom_patterns=$(grep -A 100 'sanitize_patterns:' "$config_file" 2>/dev/null | \
        grep '^\s*-\s*' | sed 's/^\s*-\s*//' | head -20)

    if [[ -n "$custom_patterns" ]]; then
        while IFS= read -r pattern; do
            pattern=$(echo "$pattern" | tr -d '"' | tr -d "'")
            [[ -z "$pattern" ]] && continue
            _SANITIZE_SED_SCRIPT="${_SANITIZE_SED_SCRIPT}s/${pattern}/[REDACTED:custom]/g;"
        done <<< "$custom_patterns"
    fi
}
