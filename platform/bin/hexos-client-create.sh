#!/usr/bin/env bash
set -euo pipefail

# HexOS Phase 1 — Workspace Jail: Client Creation Script
# Creates an isolated workspace jail for a new client agent

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLATFORM_DIR="$(dirname "$SCRIPT_DIR")"
CLIENTS_YAML="${PLATFORM_DIR}/config/clients.yaml"

# Ensure sbin paths are in PATH for admin commands
export PATH="/usr/sbin:/sbin:${PATH}"

usage() {
    echo "Usage: hexos-client-create.sh <client-name>"
    echo ""
    echo "Creates an isolated workspace jail for a new HexOS client."
    echo ""
    echo "Client name requirements:"
    echo "  - 3-32 characters"
    echo "  - Lowercase alphanumeric + hyphens only"
    echo "  - Must start with a letter"
    exit 1
}

[[ $# -lt 1 ]] && usage

CLIENT_NAME="$1"

# Validate client name: lowercase, starts with letter, 3-32 chars, alphanumeric + hyphens
if [[ ! "$CLIENT_NAME" =~ ^[a-z][a-z0-9-]{2,31}$ ]]; then
    echo "Error: Client name must be 3-32 lowercase alphanumeric + hyphens, starting with a letter"
    echo "  Got: '${CLIENT_NAME}'"
    exit 1
fi

# Disallow reserved names
if [[ "$CLIENT_NAME" == "platform" || "$CLIENT_NAME" == "shared" ]]; then
    echo "Error: '${CLIENT_NAME}' is a reserved name"
    exit 1
fi

CLIENT_USER="hexos-${CLIENT_NAME}"
CLIENT_HOME="/hexos/${CLIENT_NAME}"

# Idempotent: if user already exists, warn and exit 0
if id "$CLIENT_USER" &>/dev/null; then
    echo "Warning: Client '${CLIENT_NAME}' already exists (user ${CLIENT_USER} found). Skipping."
    # Ensure filesystem and permissions are correct anyway
    if [[ -d "$CLIENT_HOME" ]]; then
        echo "  Workspace exists at ${CLIENT_HOME}"
    fi
    exit 0
fi

echo "Creating workspace jail for client: ${CLIENT_NAME}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 1. Create system user with no login shell
useradd --system --shell /usr/sbin/nologin --no-create-home --user-group "$CLIENT_USER"
echo "  ✓ System user created: ${CLIENT_USER} (uid=$(id -u "$CLIENT_USER"))"

# 2. Create filesystem structure
mkdir -p "${CLIENT_HOME}"/{workspace/memory,data,config,skills,logs,tmp}

# Set ownership: client user owns everything under their root
chown -R "${CLIENT_USER}:${CLIENT_USER}" "${CLIENT_HOME}"

# Set permissions: only the client user can access their root
chmod 700 "${CLIENT_HOME}"

# Set subdirectory permissions
chmod 700 "${CLIENT_HOME}/workspace"
chmod 700 "${CLIENT_HOME}/data"
chmod 700 "${CLIENT_HOME}/config"
chmod 700 "${CLIENT_HOME}/skills"
chmod 700 "${CLIENT_HOME}/logs"
chmod 700 "${CLIENT_HOME}/tmp"

echo "  ✓ Filesystem created: ${CLIENT_HOME}/"
echo "    ├── workspace/memory/"
echo "    ├── data/"
echo "    ├── config/"
echo "    ├── skills/"
echo "    ├── logs/"
echo "    └── tmp/"

# 3. Create a placeholder AGENTS.md in workspace
cat > "${CLIENT_HOME}/workspace/AGENTS.md" <<'AGENTS_EOF'
# Agent Workspace

This is the agent workspace for this HexOS client.
AGENTS_EOF
chown "${CLIENT_USER}:${CLIENT_USER}" "${CLIENT_HOME}/workspace/AGENTS.md"

# 4. Ensure the systemd template is installed
TEMPLATE_SRC="${PLATFORM_DIR}/templates/hexos-agent@.service"
TEMPLATE_DST="/etc/systemd/system/hexos-agent@.service"

if [[ -f "$TEMPLATE_SRC" ]]; then
    cp "$TEMPLATE_SRC" "$TEMPLATE_DST"
    systemctl daemon-reload
    echo "  ✓ Systemd template installed"
else
    echo "  ⚠ Systemd template not found at ${TEMPLATE_SRC}, skipping unit setup"
fi

# 5. Enable systemd unit for this client
if [[ -f "$TEMPLATE_DST" ]]; then
    systemctl enable "hexos-agent@${CLIENT_NAME}" 2>/dev/null || true
    echo "  ✓ Systemd unit enabled: hexos-agent@${CLIENT_NAME}.service"
fi

# 6. Refresh cross-client isolation paths
REFRESH_SCRIPT="${SCRIPT_DIR}/hexos-refresh-isolation.sh"
if [[ -x "$REFRESH_SCRIPT" ]]; then
    "$REFRESH_SCRIPT"
    echo "  ✓ Cross-client isolation paths refreshed"
else
    echo "  ⚠ Isolation refresh script not found, skipping"
fi

# 7. Register client in platform registry
if [[ ! -f "$CLIENTS_YAML" ]]; then
    echo "# HexOS Client Registry" > "$CLIENTS_YAML"
    echo "clients:" >> "$CLIENTS_YAML"
fi

# Check if client already in registry
if ! grep -q "name: ${CLIENT_NAME}" "$CLIENTS_YAML" 2>/dev/null; then
    cat >> "$CLIENTS_YAML" <<EOF
  - name: ${CLIENT_NAME}
    created: $(date -Iseconds)
    status: active
    user: ${CLIENT_USER}
    uid: $(id -u "$CLIENT_USER")
EOF
    echo "  ✓ Client registered in ${CLIENTS_YAML}"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Workspace jail created for '${CLIENT_NAME}'"
echo ""
echo "  User:      ${CLIENT_USER} (uid=$(id -u "$CLIENT_USER"))"
echo "  Home:      ${CLIENT_HOME}"
echo "  Service:   hexos-agent@${CLIENT_NAME}.service"
echo ""
echo "Next steps:"
echo "  1. Place gateway config at ${CLIENT_HOME}/config/gateway.yaml"
echo "  2. Start with: systemctl start hexos-agent@${CLIENT_NAME}"
echo "  3. Verify with: hexos security verify ${CLIENT_NAME}"
