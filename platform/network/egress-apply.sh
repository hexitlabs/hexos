#!/usr/bin/env bash
set -euo pipefail

# HexOS Phase 2 — Network Egress Control: Rule Generator + Applier
# Reads client egress YAML, resolves presets, generates nftables rules,
# and applies them atomically.
#
# Usage: egress-apply.sh <client> [--dry-run] [--check-only]
#
# Options:
#   --dry-run      Generate rules file but don't apply to nftables
#   --check-only   Generate and validate with nft --check, don't apply

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLATFORM_DIR="$(dirname "$SCRIPT_DIR")"
PRESETS_DIR="${PLATFORM_DIR}/config/egress-presets"
DNS_CACHE_DIR="/hexos/platform/cache/dns"
GENERATED_DIR="/hexos/platform/config/generated"

# Ensure sbin paths are in PATH
export PATH="/usr/sbin:/sbin:${PATH}"

usage() {
    echo "Usage: egress-apply.sh <client> [--dry-run] [--check-only]"
    echo ""
    echo "Generate and apply nftables egress rules for a client."
    echo ""
    echo "Options:"
    echo "  --dry-run      Generate rules file but don't apply"
    echo "  --check-only   Generate and validate with nft --check"
    exit 1
}

[[ $# -lt 1 ]] && usage

CLIENT="$1"
shift

DRY_RUN=false
CHECK_ONLY=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --dry-run) DRY_RUN=true ;;
        --check-only) CHECK_ONLY=true ;;
        *) echo "Unknown option: $1"; usage ;;
    esac
    shift
done

# Validate client name
if [[ ! "$CLIENT" =~ ^[a-z][a-z0-9-]{1,30}[a-z0-9]$ ]]; then
    echo "Error: Invalid client name '${CLIENT}'"
    exit 1
fi

CLIENT_USER="hexos-${CLIENT}"
CLIENT_HOME="/hexos/${CLIENT}"
CONFIG_FILE="${CLIENT_HOME}/config/egress.yaml"
TABLE_NAME="hexos_${CLIENT//-/_}"

# Check config exists
if [[ ! -f "$CONFIG_FILE" ]]; then
    echo "Error: No egress config at ${CONFIG_FILE}"
    echo "  Run: hexos egress apply <client> after creating egress.yaml"
    exit 1
fi

# Check for yq
if ! command -v yq &>/dev/null; then
    echo "Error: yq is required but not found. Install with: snap install yq"
    exit 1
fi

# Validate YAML syntax
if ! yq '.' "$CONFIG_FILE" >/dev/null 2>&1; then
    echo "Error: Invalid YAML in ${CONFIG_FILE}"
    yq '.' "$CONFIG_FILE" 2>&1 | head -5
    exit 1
fi

# Check if client is in LOCKDOWN mode
LOCKDOWN_FILE="${CLIENT_HOME}/config/.egress-lockdown"
if [[ -f "$LOCKDOWN_FILE" ]]; then
    echo "⚠️  Client ${CLIENT} is in LOCKDOWN mode — all egress blocked"
    echo "  Run: hexos egress unlock ${CLIENT} to restore normal policy"
    # Generate lockdown rules instead
    generate_lockdown_rules=true
else
    generate_lockdown_rules=false
fi

echo "Generating egress rules for client: ${CLIENT}"

# ── Parse egress config ──────────────────────────────────────────────────

# Get DNS resolver (validate it's a valid IPv4 address)
DNS_RESOLVER=$(yq -r '.egress.dns.resolver // "127.0.0.53"' "$CONFIG_FILE")
if [[ ! "$DNS_RESOLVER" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "Error: Invalid DNS resolver address '${DNS_RESOLVER}' — must be IPv4"
    exit 1
fi

# Get logging config
LOG_BLOCKED=$(yq -r '.egress.logging.log_blocked // true' "$CONFIG_FILE")
LOG_RATE=$(yq -r '.egress.logging.rate_limit // 100' "$CONFIG_FILE")

# ── Collect all allowed hosts ────────────────────────────────────────────

ALL_HOSTS=()
ALL_PORTS=()
HAS_WILDCARD=false
WILDCARD_PORTS=()

# Load presets
PRESETS=$(yq -r '.egress.presets[]? // empty' "$CONFIG_FILE" 2>/dev/null || true)
for preset in $PRESETS; do
    preset_file="${PRESETS_DIR}/${preset}.yaml"
    if [[ ! -f "$preset_file" ]]; then
        echo "Warning: Unknown preset '${preset}', skipping"
        continue
    fi

    # Check for unrestricted preset (web-general)
    unrestricted=$(yq -r '.unrestricted_ports[]? // empty' "$preset_file" 2>/dev/null || true)
    if [[ -n "$unrestricted" ]]; then
        HAS_WILDCARD=true
        for p in $unrestricted; do
            WILDCARD_PORTS+=("$p")
        done
        echo "  Preset: ${preset} (unrestricted ports: ${unrestricted})"
        continue
    fi

    # Regular preset — collect hosts
    while IFS= read -r line; do
        host=$(echo "$line" | yq -r '.host')
        ports=$(echo "$line" | yq -r '.ports[]? // 443')
        ALL_HOSTS+=("$host")
        ALL_PORTS+=("$ports")
    done < <(yq -c '.allow[]?' "$preset_file")
    echo "  Preset: ${preset}"
done

# Load custom rules
while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    host=$(echo "$line" | yq -r '.host')
    port=$(echo "$line" | yq -r '.port // 443')
    ALL_HOSTS+=("$host")
    ALL_PORTS+=("$port")
done < <(yq -c '.egress.custom[]?' "$CONFIG_FILE" 2>/dev/null || true)

echo "  Hosts collected: ${#ALL_HOSTS[@]}"
echo "  Wildcard mode: ${HAS_WILDCARD}"

# ── DNS Resolution ───────────────────────────────────────────────────────

mkdir -p "$DNS_CACHE_DIR" 2>/dev/null || true
mkdir -p "$GENERATED_DIR" 2>/dev/null || true

RESOLVED_IPS=()
RESOLVED_PORTS=()

resolve_host() {
    local host="$1"
    local port="$2"

    # Skip wildcards — they can't be resolved to IPs
    if [[ "$host" == "*" || "$host" == *.* && "${host:0:1}" == "*" ]]; then
        # For wildcard subdomains (*.example.com), resolve the base domain
        local base_domain="${host#\*.}"
        if [[ "$base_domain" == "*" ]]; then
            return  # Pure wildcard — handled by HAS_WILDCARD
        fi
        host="$base_domain"
    fi

    # Check DNS cache (5 minute TTL)
    local cache_file="${DNS_CACHE_DIR}/${host}.cache"
    if [[ -f "$cache_file" ]]; then
        local cache_age=$(($(date +%s) - $(stat -c %Y "$cache_file" 2>/dev/null || echo "0")))
        if [[ $cache_age -lt 300 ]]; then
            while IFS= read -r ip; do
                RESOLVED_IPS+=("$ip")
                RESOLVED_PORTS+=("$port")
            done < "$cache_file"
            return
        fi
    fi

    # Resolve DNS
    local ips
    ips=$(dig +short A "$host" 2>/dev/null | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' || true)

    if [[ -z "$ips" ]]; then
        echo "  Warning: Could not resolve ${host} — skipping"
        return
    fi

    # Cache the result
    echo "$ips" > "$cache_file" 2>/dev/null || true

    while IFS= read -r ip; do
        RESOLVED_IPS+=("$ip")
        RESOLVED_PORTS+=("$port")
    done <<< "$ips"
}

for i in "${!ALL_HOSTS[@]}"; do
    resolve_host "${ALL_HOSTS[$i]}" "${ALL_PORTS[$i]:-443}"
done

echo "  Resolved IPs: ${#RESOLVED_IPS[@]}"

# ── Determine unique ports ───────────────────────────────────────────────

declare -A PORT_MAP
for p in "${RESOLVED_PORTS[@]}" "${WILDCARD_PORTS[@]}"; do
    PORT_MAP["$p"]=1
done
UNIQUE_PORTS=$(echo "${!PORT_MAP[@]}" | tr ' ' '\n' | sort -n | tr '\n' ', ' | sed 's/,$//')

if [[ -z "$UNIQUE_PORTS" && "$HAS_WILDCARD" == "false" ]]; then
    UNIQUE_PORTS="443"
fi

# ── Build unique IP set ──────────────────────────────────────────────────

declare -A IP_SET
for ip in "${RESOLVED_IPS[@]}"; do
    IP_SET["$ip"]=1
done
IP_LIST=$(echo "${!IP_SET[@]}" | tr ' ' '\n' | sort -V | tr '\n' ',' | sed 's/,$//')

# ── Generate nftables rules ─────────────────────────────────────────────

RULES_FILE="${GENERATED_DIR}/${CLIENT}-egress.nft"

if [[ "$generate_lockdown_rules" == "true" ]]; then
    # LOCKDOWN: block everything
    cat > "$RULES_FILE" <<EOF
#!/usr/sbin/nft -f
# Auto-generated LOCKDOWN egress rules for client: ${CLIENT}
# Generated: $(date -Iseconds)
# Source: LOCKDOWN MODE
# DO NOT EDIT — regenerated on every 'hexos egress apply'

table inet ${TABLE_NAME} {
    chain output {
        type filter hook output priority 0; policy accept;
        meta skuid ${CLIENT_USER} jump client_rules
    }

    chain client_rules {
        # LOCKDOWN — block ALL egress including loopback
        # Allow established (so existing connections can gracefully close)
        ct state established,related accept

        # Log + drop everything
        log prefix "hexos-egress-LOCKDOWN-${CLIENT}: " group 1 counter drop
    }
}
EOF
else
    # Normal rules
    cat > "$RULES_FILE" <<EOF
#!/usr/sbin/nft -f
# Auto-generated egress rules for client: ${CLIENT}
# Generated: $(date -Iseconds)
# Source: ${CONFIG_FILE}
# DO NOT EDIT — regenerated on every 'hexos egress apply'

table inet ${TABLE_NAME} {
    chain output {
        type filter hook output priority 0; policy accept;
        meta skuid ${CLIENT_USER} jump client_rules
    }

    chain client_rules {
        # Allow established/related connections (for connection tracking)
        ct state established,related accept

        # Allow loopback (localhost communication)
        oifname "lo" accept

        # Allow DNS to platform resolver ONLY
        ip daddr ${DNS_RESOLVER} udp dport 53 accept
        ip daddr ${DNS_RESOLVER} tcp dport 53 accept

        # Allow ICMP echo (ping) for diagnostics — limited
        ip protocol icmp icmp type { echo-request, echo-reply } limit rate 10/second accept

        # Block IPv6 by default (prevents curl -6 bypass)
        # IPv6 allowlist support can be added per-client if needed
        meta nfproto ipv6 counter drop
EOF

    # Add wildcard port rules (if unrestricted)
    if [[ "$HAS_WILDCARD" == "true" ]]; then
        for wp in "${WILDCARD_PORTS[@]}"; do
            echo "        # Unrestricted port ${wp} (from web-general or similar preset)" >> "$RULES_FILE"
            echo "        tcp dport ${wp} accept" >> "$RULES_FILE"
        done
    elif [[ -n "$IP_LIST" ]]; then
        # Add allowlisted IP rules via named set
        echo "" >> "$RULES_FILE"
        echo "        # Allowlisted endpoints (resolved from hostnames)" >> "$RULES_FILE"
        echo "        ip daddr @${CLIENT//-/_}_allowed_v4 tcp dport { ${UNIQUE_PORTS} } accept" >> "$RULES_FILE"
    fi

    # Log + drop
    echo "" >> "$RULES_FILE"
    if [[ "$LOG_BLOCKED" == "true" ]]; then
        echo "        # Log blocked connections (rate-limited to ${LOG_RATE}/min)" >> "$RULES_FILE"
        echo "        log prefix \"hexos-egress-${CLIENT}-DENY: \" group 1 limit rate ${LOG_RATE}/minute counter drop" >> "$RULES_FILE"
        echo "        counter drop" >> "$RULES_FILE"
    else
        echo "        # Drop without logging" >> "$RULES_FILE"
        echo "        counter drop" >> "$RULES_FILE"
    fi

    echo "    }" >> "$RULES_FILE"

    # Add named set for resolved IPs (unless wildcard mode)
    if [[ "$HAS_WILDCARD" == "false" && -n "$IP_LIST" ]]; then
        cat >> "$RULES_FILE" <<EOF

    set ${CLIENT//-/_}_allowed_v4 {
        type ipv4_addr
        flags interval
        elements = { ${IP_LIST} }
    }
EOF
    fi

    echo "}" >> "$RULES_FILE"
fi

echo ""
echo "Generated rules: ${RULES_FILE}"

# ── Apply or validate ────────────────────────────────────────────────────

if [[ "$DRY_RUN" == "true" ]]; then
    echo "Dry-run mode — rules not applied"
    echo ""
    cat "$RULES_FILE"
    exit 0
fi

if [[ "$CHECK_ONLY" == "true" ]]; then
    echo "Validating rules with nft --check..."
    if nft --check -f "$RULES_FILE" 2>&1; then
        echo "✓ Rules are valid"
        exit 0
    else
        echo "✗ Rules validation failed"
        exit 1
    fi
fi

# Atomic apply: delete old table then load new one
echo "Applying rules..."

# Delete existing table for this client (ignore errors if doesn't exist)
nft delete table inet "${TABLE_NAME}" 2>/dev/null || true

# Apply new rules
if nft -f "$RULES_FILE"; then
    echo "✓ Egress policy applied for ${CLIENT}"
    echo "  Table: inet ${TABLE_NAME}"
    echo "  Presets: ${PRESETS:-none}"
    echo "  Custom hosts: $(yq -r '.egress.custom | length // 0' "$CONFIG_FILE")"
    echo "  Resolved IPs: ${#RESOLVED_IPS[@]}"
    echo "  DNS resolver: ${DNS_RESOLVER}"

    # Record apply timestamp
    date -Iseconds > "${CLIENT_HOME}/config/.egress-applied" 2>/dev/null || true
else
    echo "✗ Failed to apply egress rules for ${CLIENT}"
    exit 1
fi
