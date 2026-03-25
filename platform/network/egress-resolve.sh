#!/usr/bin/env bash
set -euo pipefail

# HexOS Phase 2 — DNS Resolution Pipeline
# Refreshes IP addresses for hostname-based allowlists.
# Updates nftables named sets atomically without regenerating full ruleset.
#
# Usage: egress-resolve.sh <client>
# Designed to run via systemd timer every 5 minutes.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLATFORM_DIR="$(dirname "$SCRIPT_DIR")"
PRESETS_DIR="${PLATFORM_DIR}/config/egress-presets"
DNS_CACHE_DIR="/hexos/platform/cache/dns"

export PATH="/usr/sbin:/sbin:${PATH}"

[[ $# -lt 1 ]] && { echo "Usage: egress-resolve.sh <client>"; exit 1; }

CLIENT="$1"
CLIENT_HOME="/hexos/${CLIENT}"
CONFIG_FILE="${CLIENT_HOME}/config/egress.yaml"
TABLE_NAME="hexos_${CLIENT//-/_}"
SET_NAME="${CLIENT//-/_}_allowed_v4"

if [[ ! -f "$CONFIG_FILE" ]]; then
    echo "No egress config for ${CLIENT} — skipping"
    exit 0
fi

# Check if client is in LOCKDOWN or using web-general (no need to resolve)
if [[ -f "${CLIENT_HOME}/config/.egress-lockdown" ]]; then
    exit 0
fi

# Check for unrestricted preset
has_unrestricted=false
PRESETS=$(yq -r '.egress.presets[]? // ""' "$CONFIG_FILE" 2>/dev/null || true)
for preset in $PRESETS; do
    preset_file="${PRESETS_DIR}/${preset}.yaml"
    if [[ -f "$preset_file" ]]; then
        if yq -r '.unrestricted_ports[]? // ""' "$preset_file" 2>/dev/null | grep -q .; then
            has_unrestricted=true
            break
        fi
    fi
done

if [[ "$has_unrestricted" == "true" ]]; then
    exit 0  # No IP set needed for unrestricted mode
fi

# Collect all hostnames from presets + custom
ALL_HOSTS=()

for preset in $PRESETS; do
    preset_file="${PRESETS_DIR}/${preset}.yaml"
    [[ -f "$preset_file" ]] || continue
    host_count=$(yq '.allow | length' "$preset_file" 2>/dev/null || echo 0)
    for ((i=0; i<host_count; i++)); do
        host=$(yq -r ".allow[$i].host" "$preset_file")
        [[ -n "$host" && "$host" != "null" ]] && ALL_HOSTS+=("$host")
    done
done

custom_count=$(yq '.egress.custom | length' "$CONFIG_FILE" 2>/dev/null || echo 0)
for ((i=0; i<custom_count; i++)); do
    host=$(yq -r ".egress.custom[$i].host" "$CONFIG_FILE")
    [[ -n "$host" && "$host" != "null" ]] && ALL_HOSTS+=("$host")
done

# Resolve all hostnames to IPs
mkdir -p "$DNS_CACHE_DIR" 2>/dev/null || true
NEW_IPS=()

for host in "${ALL_HOSTS[@]}"; do
    # Handle wildcards — resolve base domain
    resolve_host="$host"
    if [[ "${host:0:2}" == "*." ]]; then
        resolve_host="${host#\*.}"
    fi
    [[ "$resolve_host" == "*" ]] && continue

    ips=$(dig +short A "$resolve_host" 2>/dev/null | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' || true)
    for ip in $ips; do
        NEW_IPS+=("$ip")
    done

    # Update cache
    if [[ -n "$ips" ]]; then
        echo "$ips" > "${DNS_CACHE_DIR}/${resolve_host}.cache" 2>/dev/null || true
    fi
done

# Deduplicate
declare -A IP_MAP
for ip in "${NEW_IPS[@]}"; do
    IP_MAP["$ip"]=1
done

UNIQUE_IPS=$(echo "${!IP_MAP[@]}" | tr ' ' '\n' | sort -V | tr '\n' ',' | sed 's/,$//')

if [[ -z "$UNIQUE_IPS" ]]; then
    echo "Warning: No IPs resolved for ${CLIENT}"
    exit 0
fi

# Atomic set replacement — single nft -f command to avoid race condition
# (flush + add in one transaction, never leaves the set empty)
echo "Updating DNS resolution for ${CLIENT}: ${#IP_MAP[@]} IPs"

NFT_SCRIPT=$(mktemp /tmp/hexos-nft-XXXXXX.nft)
cat > "$NFT_SCRIPT" <<EOF
flush set inet ${TABLE_NAME} ${SET_NAME}
add element inet ${TABLE_NAME} ${SET_NAME} { ${UNIQUE_IPS} }
EOF

nft -f "$NFT_SCRIPT" 2>/dev/null || {
    rm -f "$NFT_SCRIPT"
    echo "Warning: Could not update set ${SET_NAME} — table may not exist yet"
    exit 0
}
rm -f "$NFT_SCRIPT"

echo "✓ DNS updated for ${CLIENT}: ${#IP_MAP[@]} IPs in set ${SET_NAME}"
