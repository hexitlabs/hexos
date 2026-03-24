#!/usr/bin/env bash
# HexOS Phase 1.5 — Policy Loader
# Loads, validates, and manages per-client scan policies
#
# Usage: policy-loader.sh <action> [args...]
#   resolve <client>        Print resolved policy file path
#   get <client> [key]      Get value from effective policy
#   set <client> <file>     Set client-specific policy override
#   reset <client>          Remove client override, use default
#   validate <file>         Validate a policy YAML file
#   show <client>           Print effective policy
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_POLICY="${SCRIPT_DIR}/policies/default.yaml"

ACTION="${1:-}"
ARG2="${2:-}"
ARG3="${3:-}"

usage() {
    cat <<EOF
HexOS Security Policy Loader

Usage: policy-loader.sh <action> [args...]

Actions:
  resolve <client>        Print resolved policy file path
  get <client> [key]      Get value from effective policy
  set <client> <file>     Set client-specific policy override
  reset <client>          Remove client policy override
  validate <file>         Validate a policy YAML file
  show <client>           Print effective policy for client
EOF
    exit 3
}

[[ -z "$ACTION" ]] && usage

# --- Policy resolution: client-specific → default ---
resolve_policy() {
    local client="$1"
    local client_policy="/hexos/${client}/security/policies/scan-policy.yaml"
    if [[ -n "$client" && -f "$client_policy" ]]; then
        echo "$client_policy"
    elif [[ -f "$DEFAULT_POLICY" ]]; then
        echo "$DEFAULT_POLICY"
    else
        echo "Error: No policy found" >&2
        return 1
    fi
}

# --- YAML validation (no external deps) ---
validate_yaml() {
    local file="$1"
    [[ ! -f "$file" ]] && { echo "Error: File not found: $file" >&2; return 1; }
    [[ ! -s "$file" ]] && { echo "Error: Policy file is empty" >&2; return 1; }

    # Must have scan: top-level key
    grep -qE '^\s*scan:' "$file" || { echo "Error: Missing 'scan:' top-level key" >&2; return 1; }

    # Must have required sub-keys
    for key in mode extensions exclude risk_levels; do
        grep -qE "^\s+${key}:" "$file" || { echo "Error: Missing required key: ${key}" >&2; return 1; }
    done

    # Validate mode
    local mode
    mode=$(grep -E '^\s+mode:' "$file" | head -1 | sed 's/^[^:]*:\s*//' | tr -d '[:space:]')
    if [[ "$mode" != "strict" && "$mode" != "permissive" ]]; then
        echo "Error: mode must be 'strict' or 'permissive', got: '$mode'" >&2
        return 1
    fi

    echo "✅ Policy validation passed: $file"
    return 0
}

# --- Get a policy value ---
get_value() {
    local file="$1" key="${2:-}"
    if [[ -z "$key" ]]; then
        cat "$file"
    else
        grep -E "^\s*${key}:" "$file" | head -1 | sed 's/^[^:]*:\s*//'
    fi
}

# --- Actions ---
case "$ACTION" in
    resolve)
        [[ -z "$ARG2" ]] && { echo "Error: client name required" >&2; exit 3; }
        resolve_policy "$ARG2"
        ;;
    get)
        [[ -z "$ARG2" ]] && { echo "Error: client name required" >&2; exit 3; }
        POLICY=$(resolve_policy "$ARG2") || exit 3
        get_value "$POLICY" "$ARG3"
        ;;
    set)
        [[ -z "$ARG2" ]] && { echo "Error: client name required" >&2; exit 3; }
        [[ -z "$ARG3" ]] && { echo "Error: source policy file required" >&2; exit 3; }
        validate_yaml "$ARG3" || exit 1
        CLIENT_DIR="/hexos/${ARG2}/security/policies"
        mkdir -p "$CLIENT_DIR"
        cp "$ARG3" "${CLIENT_DIR}/scan-policy.yaml"
        echo "✅ Policy set for client '${ARG2}'"
        ;;
    reset)
        [[ -z "$ARG2" ]] && { echo "Error: client name required" >&2; exit 3; }
        CLIENT_POLICY="/hexos/${ARG2}/security/policies/scan-policy.yaml"
        if [[ -f "$CLIENT_POLICY" ]]; then
            rm -f "$CLIENT_POLICY"
            echo "✅ Client policy removed — using default"
        else
            echo "No client-specific policy found for '${ARG2}'"
        fi
        ;;
    validate)
        [[ -z "$ARG2" ]] && { echo "Error: policy file path required" >&2; exit 3; }
        validate_yaml "$ARG2"
        ;;
    show)
        [[ -z "$ARG2" ]] && { echo "Error: client name required" >&2; exit 3; }
        POLICY=$(resolve_policy "$ARG2") || exit 3
        echo "# Effective policy for: ${ARG2}"
        echo "# Source: ${POLICY}"
        echo "---"
        cat "$POLICY"
        ;;
    *)
        echo "Unknown action: $ACTION" >&2
        usage
        ;;
esac
