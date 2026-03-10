#!/bin/bash
# ============================================================================
# HexOS Deploy — Remote server deployment script
# Usage: ./scripts/deploy.sh --host <ip> --config <client.yaml> [options]
#
# Options:
#   --host       Remote server IP or hostname (required)
#   --config     Path to client YAML config file (required)
#   --user       SSH user (default: root)
#   --key        SSH private key path (default: ~/.ssh/id_ed25519)
#   --harden     Run server hardening before deploy
#   --dry-run    Show what would be done without executing
# ============================================================================

set -euo pipefail

# ── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m' # No Color

# ── Helpers ─────────────────────────────────────────────────────────────────
step_num=0
total_steps=12

step() {
  step_num=$((step_num + 1))
  echo -e "\n${BLUE}[${step_num}/${total_steps}]${NC} ${BOLD}$1${NC}"
}

info() {
  echo -e "  ${DIM}→${NC} $1"
}

success() {
  echo -e "  ${GREEN}✓${NC} $1"
}

warn() {
  echo -e "  ${YELLOW}⚠${NC} $1"
}

fail() {
  echo -e "\n${RED}✗ ERROR:${NC} $1"
  if [ -n "${2:-}" ]; then
    echo -e "  ${DIM}Hint: $2${NC}"
  fi
  exit 1
}

banner() {
  echo -e "${CYAN}"
  echo "  ╔═══════════════════════════════════════╗"
  echo "  ║          HexOS Deploy v1.0            ║"
  echo "  ║     Remote Server Deployment Tool     ║"
  echo "  ╚═══════════════════════════════════════╝"
  echo -e "${NC}"
}

# ── Parse Arguments ─────────────────────────────────────────────────────────
HOST=""
CONFIG=""
USER="root"
KEY="$HOME/.ssh/id_ed25519"
HARDEN=false
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host)     HOST="$2"; shift 2 ;;
    --config)   CONFIG="$2"; shift 2 ;;
    --user)     USER="$2"; shift 2 ;;
    --key)      KEY="$2"; shift 2 ;;
    --harden)   HARDEN=true; shift ;;
    --dry-run)  DRY_RUN=true; shift ;;
    --help|-h)
      echo "Usage: ./scripts/deploy.sh --host <ip> --config <client.yaml> [--user root] [--key ~/.ssh/id_ed25519] [--harden] [--dry-run]"
      exit 0
      ;;
    *) fail "Unknown argument: $1" "Run with --help for usage" ;;
  esac
done

# ── Resolve paths ───────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SSH_OPTS="-o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -i $KEY"
SSH_CMD="ssh $SSH_OPTS ${USER}@${HOST}"
REMOTE_DIR="/opt/hexos"
SERVICE_NAME="hexos-gateway"

banner

# ══════════════════════════════════════════════════════════════════════════════
# STEP 1: Validate arguments
# ══════════════════════════════════════════════════════════════════════════════
step "Validating arguments"

[[ -z "$HOST" ]] && fail "Missing --host argument" "Provide the remote server IP: --host 1.2.3.4"
[[ -z "$CONFIG" ]] && fail "Missing --config argument" "Provide the client config: --config clients/jirka.yaml"

# Resolve config path relative to repo
if [[ ! "$CONFIG" = /* ]]; then
  CONFIG="$REPO_DIR/$CONFIG"
fi

[[ ! -f "$CONFIG" ]] && fail "Config file not found: $CONFIG" "Create it from clients/template.yaml"
[[ ! -f "$KEY" ]] && fail "SSH key not found: $KEY" "Generate one with: ssh-keygen -t ed25519"

success "Host: $HOST"
success "Config: $CONFIG"
success "User: $USER"
success "SSH Key: $KEY"

if $DRY_RUN; then
  warn "DRY RUN mode — no changes will be made"
fi

# ══════════════════════════════════════════════════════════════════════════════
# STEP 2: Check SSH connectivity
# ══════════════════════════════════════════════════════════════════════════════
step "Checking SSH connectivity"

if $DRY_RUN; then
  info "Would test SSH connection to ${USER}@${HOST}"
else
  if $SSH_CMD "echo 'HexOS deploy connected'" 2>/dev/null; then
    success "SSH connection to ${USER}@${HOST} successful"
  else
    fail "Cannot connect to ${USER}@${HOST}" "Check your SSH key and that the server is reachable: ssh -i $KEY ${USER}@${HOST}"
  fi
fi

# ══════════════════════════════════════════════════════════════════════════════
# STEP 3: Run server hardening (optional)
# ══════════════════════════════════════════════════════════════════════════════
step "Server hardening"

if $HARDEN; then
  HARDEN_SCRIPT="$REPO_DIR/scripts/harden.sh"
  if [[ -f "$HARDEN_SCRIPT" ]]; then
    info "Uploading and running harden.sh on remote..."
    if ! $DRY_RUN; then
      scp $SSH_OPTS "$HARDEN_SCRIPT" "${USER}@${HOST}:/tmp/harden.sh"
      $SSH_CMD "chmod +x /tmp/harden.sh && bash /tmp/harden.sh && rm /tmp/harden.sh"
    fi
    success "Server hardening complete"
  else
    warn "harden.sh not found at $HARDEN_SCRIPT — skipping"
  fi
else
  info "Skipped (use --harden to enable)"
fi

# ══════════════════════════════════════════════════════════════════════════════
# STEP 4: Install Node.js 22 LTS
# ══════════════════════════════════════════════════════════════════════════════
step "Checking Node.js on remote"

if $DRY_RUN; then
  info "Would check and install Node.js 22 LTS if needed"
else
  NODE_VERSION=$($SSH_CMD "node --version 2>/dev/null" || echo "none")
  if [[ "$NODE_VERSION" == v22.* ]]; then
    success "Node.js $NODE_VERSION already installed"
  elif [[ "$NODE_VERSION" == v2[0-9].* ]]; then
    warn "Node.js $NODE_VERSION found (v22 recommended, but proceeding)"
  else
    info "Installing Node.js 22 LTS via NodeSource..."
    $SSH_CMD bash -s << 'INSTALL_NODE'
      set -e
      apt-get update -qq
      apt-get install -y -qq ca-certificates curl gnupg
      mkdir -p /etc/apt/keyrings
      curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg 2>/dev/null
      echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
      apt-get update -qq
      apt-get install -y -qq nodejs
INSTALL_NODE
    NEW_VERSION=$($SSH_CMD "node --version")
    success "Node.js $NEW_VERSION installed"
  fi
fi

# ══════════════════════════════════════════════════════════════════════════════
# STEP 5: Create remote directory structure
# ══════════════════════════════════════════════════════════════════════════════
step "Creating remote directory structure"

if $DRY_RUN; then
  info "Would create $REMOTE_DIR on remote"
else
  $SSH_CMD bash -s << SETUP_DIRS
    set -e
    mkdir -p $REMOTE_DIR
    mkdir -p $REMOTE_DIR/workspace
    mkdir -p $REMOTE_DIR/workspace/memory
    # Create hexos user if it doesn't exist
    if ! id -u hexos >/dev/null 2>&1; then
      useradd --system --home-dir $REMOTE_DIR --shell /bin/bash hexos
      echo "Created hexos system user"
    fi
SETUP_DIRS
  success "Directory structure ready at $REMOTE_DIR"
fi

# ══════════════════════════════════════════════════════════════════════════════
# STEP 6: Rsync HexOS repo to remote
# ══════════════════════════════════════════════════════════════════════════════
step "Syncing HexOS to remote server"

if $DRY_RUN; then
  info "Would rsync $REPO_DIR → ${USER}@${HOST}:$REMOTE_DIR"
else
  info "Syncing files (excluding .git, node_modules, clients)..."
  rsync -azP --delete \
    --exclude='.git' \
    --exclude='node_modules' \
    --exclude='clients/' \
    --exclude='.env*' \
    --exclude='*.tgz' \
    -e "ssh $SSH_OPTS" \
    "$REPO_DIR/" "${USER}@${HOST}:$REMOTE_DIR/"
  success "Files synced to $REMOTE_DIR"
fi

# ══════════════════════════════════════════════════════════════════════════════
# STEP 7: Install npm dependencies
# ══════════════════════════════════════════════════════════════════════════════
step "Installing npm dependencies on remote"

if $DRY_RUN; then
  info "Would run npm install --production on remote"
else
  info "Running npm install (this may take a minute)..."
  $SSH_CMD bash -s << INSTALL_DEPS
    set -e
    cd $REMOTE_DIR
    npm install --production --no-audit --no-fund 2>&1 | tail -5
INSTALL_DEPS
  success "Dependencies installed"
fi

# ══════════════════════════════════════════════════════════════════════════════
# STEP 8: Generate config from client YAML
# ══════════════════════════════════════════════════════════════════════════════
step "Generating HexOS configuration"

if $DRY_RUN; then
  info "Would generate config from $CONFIG"
else
  WORKSPACE_DIR="$REMOTE_DIR/workspace"

  # Generate config locally using our generator script
  TEMP_OUTPUT=$(mktemp -d)
  info "Generating config files from client YAML..."

  if [[ -f "$REPO_DIR/scripts/generate-config.cjs" ]]; then
    node "$REPO_DIR/scripts/generate-config.cjs" "$CONFIG" --output "$TEMP_OUTPUT"
  else
    warn "generate-config.cjs not found — creating minimal config"
    # Fallback: extract basic fields from YAML manually
    BOT_TOKEN=$(grep 'bot_token:' "$CONFIG" | head -1 | sed 's/.*bot_token:\s*"\?\([^"]*\)"\?.*/\1/' | tr -d ' ')
    ASSISTANT_NAME=$(grep -A1 '^assistant:' "$CONFIG" | grep 'name:' | sed 's/.*name:\s*"\?\([^"]*\)"\?.*/\1/' | tr -d ' ')
    API_KEY=$(grep -A2 '^api:' "$CONFIG" | grep 'key:' | sed 's/.*key:\s*"\?\([^"]*\)"\?.*/\1/' | tr -d ' ')

    cat > "$TEMP_OUTPUT/hexos.json" << HEXJSON
{
  "telegram": {
    "token": "$BOT_TOKEN"
  },
  "anthropic": {
    "apiKey": "$API_KEY"
  }
}
HEXJSON
  fi

  # Upload generated files to workspace
  info "Uploading config files to remote workspace..."
  rsync -azP \
    -e "ssh $SSH_OPTS" \
    "$TEMP_OUTPUT/" "${USER}@${HOST}:$WORKSPACE_DIR/"

  rm -rf "$TEMP_OUTPUT"
  success "Configuration generated and uploaded"
fi

# ══════════════════════════════════════════════════════════════════════════════
# STEP 9: Copy workspace files
# ══════════════════════════════════════════════════════════════════════════════
step "Setting up workspace files"

if $DRY_RUN; then
  info "Would copy workspace templates"
else
  # Ensure standard workspace files exist on remote
  $SSH_CMD bash -s << 'WORKSPACE_SETUP'
    set -e
    WORKSPACE="/opt/hexos/workspace"

    # Create TOOLS.md if missing
    if [ ! -f "$WORKSPACE/TOOLS.md" ]; then
      cat > "$WORKSPACE/TOOLS.md" << 'EOF'
# TOOLS.md - Local Notes
# Add environment-specific notes here
EOF
    fi

    # Create memory directory
    mkdir -p "$WORKSPACE/memory"

    # Set permissions
    chown -R hexos:hexos /opt/hexos 2>/dev/null || true
    chmod -R 755 /opt/hexos
WORKSPACE_SETUP
  success "Workspace files configured"
fi

# ══════════════════════════════════════════════════════════════════════════════
# STEP 10: Set up systemd service
# ══════════════════════════════════════════════════════════════════════════════
step "Setting up systemd service"

if $DRY_RUN; then
  info "Would install hexos-gateway.service"
else
  SERVICE_FILE="$REPO_DIR/scripts/hexos-gateway.service"
  if [[ -f "$SERVICE_FILE" ]]; then
    scp $SSH_OPTS "$SERVICE_FILE" "${USER}@${HOST}:/etc/systemd/system/${SERVICE_NAME}.service"
  else
    # Create service file inline
    $SSH_CMD bash -s << 'SERVICE_SETUP'
      cat > /etc/systemd/system/hexos-gateway.service << 'SVCEOF'
[Unit]
Description=HexOS Gateway
After=network.target

[Service]
Type=simple
User=hexos
WorkingDirectory=/opt/hexos/workspace
ExecStart=/usr/bin/node /opt/hexos/dist/entry.js gateway start --foreground
Restart=on-failure
RestartSec=10
Environment=NODE_ENV=production
Environment=HEXOS_HOME=/opt/hexos/workspace

[Install]
WantedBy=multi-user.target
SVCEOF
SERVICE_SETUP
  fi

  $SSH_CMD "systemctl daemon-reload && systemctl enable ${SERVICE_NAME}" 2>/dev/null
  success "Systemd service installed and enabled"
fi

# ══════════════════════════════════════════════════════════════════════════════
# STEP 11: Start the service
# ══════════════════════════════════════════════════════════════════════════════
step "Starting HexOS Gateway"

if $DRY_RUN; then
  info "Would start ${SERVICE_NAME} service"
else
  $SSH_CMD "systemctl restart ${SERVICE_NAME}"
  sleep 3
  success "Service started"
fi

# ══════════════════════════════════════════════════════════════════════════════
# STEP 12: Verify deployment
# ══════════════════════════════════════════════════════════════════════════════
step "Verifying deployment"

if $DRY_RUN; then
  info "Would check service status"
else
  STATUS=$($SSH_CMD "systemctl is-active ${SERVICE_NAME}" 2>/dev/null || echo "unknown")
  if [[ "$STATUS" == "active" ]]; then
    success "HexOS Gateway is running!"
  else
    warn "Service status: $STATUS"
    info "Check logs with: ssh ${USER}@${HOST} journalctl -u ${SERVICE_NAME} -f"
    info "The service may need a moment to start, or check the config."
  fi
fi

# ── Done ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}══════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}${BOLD}  ✓ HexOS deployment complete!${NC}"
echo -e "${GREEN}${BOLD}══════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  ${BOLD}Server:${NC}     ${HOST}"
echo -e "  ${BOLD}Service:${NC}    ${SERVICE_NAME}"
echo -e "  ${BOLD}Workspace:${NC}  ${REMOTE_DIR}/workspace"
echo ""
echo -e "  ${DIM}View logs:${NC}  ssh ${USER}@${HOST} journalctl -u ${SERVICE_NAME} -f"
echo -e "  ${DIM}Restart:${NC}    ssh ${USER}@${HOST} systemctl restart ${SERVICE_NAME}"
echo -e "  ${DIM}Stop:${NC}       ssh ${USER}@${HOST} systemctl stop ${SERVICE_NAME}"
echo ""

# Extract bot username from config if available
BOT_TOKEN=$(grep 'bot_token:' "$CONFIG" 2>/dev/null | head -1 | sed 's/.*bot_token:\s*"\?\([^"]*\)"\?.*/\1/' | tr -d ' ')
if [[ -n "$BOT_TOKEN" && "$BOT_TOKEN" != "PENDING"* ]]; then
  echo -e "  ${CYAN}${BOLD}Send your client the bot link once it's configured!${NC}"
fi

echo ""
