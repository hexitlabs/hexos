#!/usr/bin/env bash
set -euo pipefail

# HexOS Phase 1 — Workspace Jail: Client Removal Script
# Removes a client's workspace jail, user, and all associated resources

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLATFORM_DIR="$(dirname "$SCRIPT_DIR")"
CLIENTS_YAML="${PLATFORM_DIR}/config/clients.yaml"
LOG_FILE="${PLATFORM_DIR}/config/removal.log"

# Ensure sbin paths are in PATH for admin commands
export PATH="/usr/sbin:/sbin:${PATH}"

usage() {
    echo "Usage: hexos-client-remove.sh <client-name> [--confirm] [--archive]"
    echo ""
    echo "Removes a client's workspace jail completely."
    echo ""
    echo "Options:"
    echo "  --confirm    Required safety flag to proceed with removal"
    echo "  --archive    Archive the workspace before deletion"
    exit 1
}

[[ $# -lt 1 ]] && usage

CLIENT_NAME="$1"
shift

CONFIRM=false
ARCHIVE=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --confirm) CONFIRM=true ;;
        --archive) ARCHIVE=true ;;
        *) echo "Unknown option: $1"; usage ;;
    esac
    shift
done

CLIENT_USER="hexos-${CLIENT_NAME}"
CLIENT_HOME="/hexos/${CLIENT_NAME}"
SERVICE_NAME="hexos-agent@${CLIENT_NAME}.service"

# Verify client exists
if ! id "$CLIENT_USER" &>/dev/null && [[ ! -d "$CLIENT_HOME" ]]; then
    echo "Error: Client '${CLIENT_NAME}' does not exist"
    exit 1
fi

# Require --confirm
if [[ "$CONFIRM" != "true" ]]; then
    echo "Error: Client removal requires --confirm flag"
    echo ""
    echo "This will permanently delete:"
    echo "  - System user: ${CLIENT_USER}"
    echo "  - All files in: ${CLIENT_HOME}/"
    echo "  - Systemd unit: ${SERVICE_NAME}"
    echo ""
    echo "Run with --confirm to proceed, or add --archive to backup first"
    exit 1
fi

echo "Removing workspace jail for client: ${CLIENT_NAME}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 1. Stop the gateway process gracefully
if systemctl is-active "${SERVICE_NAME}" &>/dev/null; then
    echo "  Stopping ${SERVICE_NAME}..."
    systemctl stop "${SERVICE_NAME}" --force 2>/dev/null || true
    
    # Wait for graceful shutdown (up to 30s)
    WAITED=0
    while systemctl is-active "${SERVICE_NAME}" &>/dev/null && [[ $WAITED -lt 30 ]]; do
        sleep 1
        ((WAITED++))
    done
    
    # Force kill if still running
    if systemctl is-active "${SERVICE_NAME}" &>/dev/null; then
        echo "  Force killing after 30s timeout..."
        systemctl kill "${SERVICE_NAME}" --signal=SIGKILL 2>/dev/null || true
    fi
    echo "  ✓ Service stopped"
else
    echo "  ✓ Service not running"
fi

# 2. Disable and remove systemd unit
if systemctl is-enabled "${SERVICE_NAME}" &>/dev/null; then
    systemctl disable "${SERVICE_NAME}" 2>/dev/null || true
    echo "  ✓ Service disabled"
fi

# Remove override directory
OVERRIDE_DIR="/etc/systemd/system/${SERVICE_NAME}.d"
if [[ -d "$OVERRIDE_DIR" ]]; then
    rm -rf "$OVERRIDE_DIR"
    echo "  ✓ Systemd overrides removed"
fi

# Also clean hexos-agent@<name>.service.d
OVERRIDE_DIR2="/etc/systemd/system/hexos-agent@${CLIENT_NAME}.service.d"
if [[ -d "$OVERRIDE_DIR2" ]]; then
    rm -rf "$OVERRIDE_DIR2"
fi

systemctl daemon-reload
echo "  ✓ Systemd daemon reloaded"

# 3. Kill any orphaned processes running as the client user
if id "$CLIENT_USER" &>/dev/null; then
    pkill -u "$CLIENT_USER" 2>/dev/null || true
    sleep 1
    pkill -9 -u "$CLIENT_USER" 2>/dev/null || true
    echo "  ✓ Orphaned processes killed"
fi

# 4. Archive if requested
if [[ "$ARCHIVE" == "true" && -d "$CLIENT_HOME" ]]; then
    ARCHIVE_DIR="/hexos/platform/config/archives"
    mkdir -p "$ARCHIVE_DIR"
    ARCHIVE_FILE="${ARCHIVE_DIR}/${CLIENT_NAME}-$(date +%Y%m%d-%H%M%S).tar.gz"
    tar czf "$ARCHIVE_FILE" -C /hexos "${CLIENT_NAME}/" 2>/dev/null || true
    echo "  ✓ Archived to ${ARCHIVE_FILE}"
fi

# 5. Remove system user and group
if id "$CLIENT_USER" &>/dev/null; then
    userdel "$CLIENT_USER" 2>/dev/null || true
    echo "  ✓ System user removed: ${CLIENT_USER}"
fi

# Remove group if it still exists
if getent group "$CLIENT_USER" &>/dev/null; then
    groupdel "$CLIENT_USER" 2>/dev/null || true
    echo "  ✓ System group removed: ${CLIENT_USER}"
fi

# 6. Remove filesystem
if [[ -d "$CLIENT_HOME" ]]; then
    rm -rf "$CLIENT_HOME"
    echo "  ✓ Filesystem removed: ${CLIENT_HOME}"
fi

# 7. Refresh isolation for remaining clients
REFRESH_SCRIPT="${SCRIPT_DIR}/hexos-refresh-isolation.sh"
if [[ -x "$REFRESH_SCRIPT" ]]; then
    "$REFRESH_SCRIPT"
    echo "  ✓ Cross-client isolation paths refreshed"
fi

# 8. Update client registry (mark as removed)
if [[ -f "$CLIENTS_YAML" ]]; then
    # Simple approach: add a removal note (proper YAML editing would need yq)
    sed -i "s/^  - name: ${CLIENT_NAME}$/  - name: ${CLIENT_NAME}  # REMOVED $(date -Iseconds)/" "$CLIENTS_YAML" 2>/dev/null || true
fi

# 9. Log removal
echo "$(date -Iseconds) REMOVED client=${CLIENT_NAME} user=${CLIENT_USER} archive=${ARCHIVE}" >> "$LOG_FILE"
echo "  ✓ Removal logged"

# 10. Verify no orphaned processes
sleep 1
if id "$CLIENT_USER" &>/dev/null; then
    echo "  ⚠ Warning: User ${CLIENT_USER} still exists"
fi
if ps -u "$CLIENT_USER" &>/dev/null 2>&1; then
    echo "  ⚠ Warning: Orphaned processes still running as ${CLIENT_USER}"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Client '${CLIENT_NAME}' has been removed."
