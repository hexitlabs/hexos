#!/usr/bin/env bash
set -euo pipefail
# HexOS Setup — Initialize deployment profile (Operator or Managed)
#
# Usage: hexos-setup.sh [operator|managed]
# If no argument, runs interactive mode.

export PATH="/usr/sbin:/sbin:${PATH}"

PLATFORM_DIR="/hexos/platform"
CONFIG_DIR="${PLATFORM_DIR}/config"
HEXOS_CONFIG="${CONFIG_DIR}/hexos.yaml"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Ensure platform directories exist
mkdir -p "$CONFIG_DIR" /hexos/shared/{skills,bin} /hexos/platform/bin /hexos/platform/templates 2>/dev/null || true

MODE="${1:-}"

# Interactive mode
if [[ -z "$MODE" ]]; then
    echo ""
    echo "╔══════════════════════════════════════════════════╗"
    echo "║  HexOS Setup                                      ║"
    echo "╚══════════════════════════════════════════════════╝"
    echo ""
    echo "Choose your deployment profile:"
    echo ""
    echo "  1) Operator  — For your own use. Full access, no restrictions."
    echo "                 Run as root, unrestricted network, maximum speed."
    echo "                 Use this for your internal agent fleet."
    echo ""
    echo "  2) Managed   — For client deployments. Full security stack."
    echo "                 Per-client isolation, pre-runtime scanning,"
    echo "                 network egress control, resource limits."
    echo "                 Use this when hosting agents for clients."
    echo ""
    read -rp "Select mode [1/2]: " choice
    case "$choice" in
        1|operator|o)  MODE="operator" ;;
        2|managed|m)   MODE="managed" ;;
        *)
            echo "Invalid choice. Run 'hexos setup operator' or 'hexos setup managed'"
            exit 1
            ;;
    esac
fi

# Validate mode
case "$MODE" in
    operator|managed) ;;
    *)
        echo "Error: Invalid mode '$MODE'. Use 'operator' or 'managed'."
        exit 1
        ;;
esac

# Copy profile template
TEMPLATE="${CONFIG_DIR}/hexos.yaml.${MODE}"
if [[ ! -f "$TEMPLATE" ]]; then
    echo "Error: Profile template not found: $TEMPLATE"
    exit 1
fi

# Backup existing config
if [[ -f "$HEXOS_CONFIG" ]]; then
    CURRENT_MODE=$(grep -oP '^\s+mode:\s+\K\w+' "$HEXOS_CONFIG" 2>/dev/null || echo "unknown")
    if [[ "$CURRENT_MODE" == "$MODE" ]]; then
        echo "Already configured as '${MODE}'. No changes needed."
        exit 0
    fi
    cp "$HEXOS_CONFIG" "${HEXOS_CONFIG}.backup.$(date +%Y%m%d-%H%M%S)"
    echo "Backed up existing config"
fi

cp "$TEMPLATE" "$HEXOS_CONFIG"
echo ""
echo "✅ HexOS configured as: ${MODE^^}"
echo "   Config: ${HEXOS_CONFIG}"

# Mode-specific setup
if [[ "$MODE" == "managed" ]]; then
    echo ""
    echo "Managed mode setup:"
    echo "  • Security layers will activate when you create clients"
    echo "  • Use 'hexos client create <name>' to onboard a client"
    echo "  • Each client gets: workspace jail + scanner + egress control"
    echo ""
    echo "Next steps:"
    echo "  1. hexos client create <client-name>"
    echo "  2. Configure client's egress policy at /hexos/<client>/config/egress.yaml"
    echo "  3. hexos egress apply <client-name>"
elif [[ "$MODE" == "operator" ]]; then
    echo ""
    echo "Operator mode setup:"
    echo "  • No security restrictions active"
    echo "  • Full root access, unrestricted network"
    echo "  • Security scanner available on-demand: hexos security scan <path>"
    echo ""
    echo "You're good to go. No further setup needed."
fi

echo ""
echo "Run 'hexos mode' to check current profile."
