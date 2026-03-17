#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# HexOS Server Security Hardening Wizard
# Hardens a fresh Ubuntu VPS for production use.
# Can be run standalone or via `hexos secure`.
# ─────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Colours & formatting ────────────────────────────────────────────
BOLD='\033[1m'
DIM='\033[2m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
RESET='\033[0m'

LOGFILE="/var/log/hexos-secure.log"

# Track what we configured for the summary
declare -a SUMMARY_ITEMS=()

# ── Helpers ──────────────────────────────────────────────────────────

log() {
  local ts
  ts="$(date '+%Y-%m-%d %H:%M:%S')"
  echo "[$ts] $*" >> "$LOGFILE" 2>/dev/null || true
}

info()  { echo -e "${CYAN}ℹ${RESET}  $*"; log "INFO: $*"; }
ok()    { echo -e "${GREEN}✔${RESET}  $*"; log "OK: $*"; }
warn()  { echo -e "${YELLOW}⚠${RESET}  $*"; log "WARN: $*"; }
err()   { echo -e "${RED}✖${RESET}  $*"; log "ERROR: $*"; }
step()  { echo -e "\n${BOLD}${CYAN}── $* ──${RESET}"; log "STEP: $*"; }

confirm() {
  local prompt="$1"
  local default="${2:-Y}"
  local yn
  if [[ "$default" == "Y" ]]; then
    read -rp "$(echo -e "${BOLD}$prompt [Y/n]${RESET} ")" yn
    yn="${yn:-Y}"
  else
    read -rp "$(echo -e "${BOLD}$prompt [y/N]${RESET} ")" yn
    yn="${yn:-N}"
  fi
  [[ "$yn" =~ ^[Yy] ]]
}

banner() {
  echo -e "${CYAN}"
  echo "  ╦ ╦┌─┐─┐ ┬╔═╗╔═╗  ╔═╗┌─┐┌─┐┬ ┬┬─┐┌─┐"
  echo "  ╠═╣├┤ ┌┴┬┘║ ║╚═╗  ╚═╗├┤ │  │ │├┬┘├┤ "
  echo "  ╩ ╩└─┘┴ └─╚═╝╚═╝  ╚═╝└─┘└─┘└─┘┴└─└─┘"
  echo -e "${RESET}"
  echo -e "  ${DIM}Server Security Hardening Wizard${RESET}"
  echo ""
}

usage() {
  banner
  echo "Usage: $(basename "$0") [OPTIONS]"
  echo ""
  echo "Harden a fresh Ubuntu VPS for production use."
  echo ""
  echo "Options:"
  echo "  -h, --help          Show this help message"
  echo "  --ssh-port PORT     SSH port to allow (default: auto-detect or 22)"
  echo "  --gateway-port PORT Gateway port to allow (default: 18789)"
  echo "  --non-interactive   Skip all prompts, apply all defaults"
  echo ""
  echo "Steps (each with confirmation prompt):"
  echo "  1. UFW Firewall       - Install & configure firewall rules"
  echo "  2. SSH Hardening      - Disable password auth, harden sshd"
  echo "  3. Fail2ban           - Install & configure intrusion prevention"
  echo "  4. Auto Updates       - Enable automatic security updates"
  echo "  5. HexOS Service User - Create dedicated system user (optional)"
  echo ""
  echo "Log: $LOGFILE"
  exit 0
}

# ── Argument parsing ─────────────────────────────────────────────────

SSH_PORT=""
GATEWAY_PORT="18789"
NON_INTERACTIVE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage ;;
    --ssh-port) SSH_PORT="$2"; shift 2 ;;
    --gateway-port) GATEWAY_PORT="$2"; shift 2 ;;
    --non-interactive) NON_INTERACTIVE=true; shift ;;
    *) err "Unknown option: $1"; usage ;;
  esac
done

# Non-interactive confirm always returns true
if $NON_INTERACTIVE; then
  confirm() { return 0; }
fi

# ── Pre-flight checks ───────────────────────────────────────────────

preflight() {
  if [[ $EUID -ne 0 ]]; then
    err "This script must be run as root (or with sudo)."
    exit 1
  fi

  # Check OS
  if [[ -f /etc/os-release ]]; then
    . /etc/os-release
    if [[ "${ID:-}" != "ubuntu" ]]; then
      warn "This script is designed for Ubuntu. Detected: ${ID:-unknown}. Proceeding anyway..."
    fi
  fi

  # Ensure log directory exists
  mkdir -p "$(dirname "$LOGFILE")"
  touch "$LOGFILE" 2>/dev/null || true

  log "=== HexOS Secure started ==="
  log "User: $(whoami), OS: $(cat /etc/os-release 2>/dev/null | grep PRETTY_NAME | cut -d= -f2 | tr -d '"')"
}

# ── Detect SSH port ─────────────────────────────────────────────────

detect_ssh_port() {
  if [[ -n "$SSH_PORT" ]]; then
    return
  fi

  # Try to detect from sshd config
  local port
  port=$(grep -E '^\s*Port\s+' /etc/ssh/sshd_config 2>/dev/null | awk '{print $2}' | head -1)
  if [[ -n "$port" && "$port" != "22" ]]; then
    SSH_PORT="$port"
    info "Detected SSH port from sshd_config: $SSH_PORT"
    return
  fi

  # Try to detect from current SSH connection
  if [[ -n "${SSH_CONNECTION:-}" ]]; then
    port=$(echo "$SSH_CONNECTION" | awk '{print $4}')
    if [[ -n "$port" ]]; then
      SSH_PORT="$port"
      info "Detected SSH port from active connection: $SSH_PORT"
      return
    fi
  fi

  SSH_PORT="22"
}

# ── Step 1: UFW Firewall ────────────────────────────────────────────

setup_ufw() {
  step "UFW Firewall"

  # Check if ufw is already active
  if command -v ufw &>/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
    ok "UFW is already active"
    echo ""
    ufw status numbered 2>/dev/null || true
    echo ""
    if ! confirm "UFW is already configured. Re-apply rules?"; then
      info "Skipping UFW configuration"
      SUMMARY_ITEMS+=("UFW Firewall: already active (skipped)")
      return
    fi
  fi

  if ! confirm "Configure UFW firewall?"; then
    info "Skipping UFW configuration"
    SUMMARY_ITEMS+=("UFW Firewall: skipped")
    return
  fi

  # Install if not present
  if ! command -v ufw &>/dev/null; then
    info "Installing ufw..."
    apt-get update -qq && apt-get install -y -qq ufw >> "$LOGFILE" 2>&1
    ok "ufw installed"
  fi

  # Reset to defaults (non-interactive)
  ufw --force reset >> "$LOGFILE" 2>&1

  # Default deny incoming, allow outgoing
  ufw default deny incoming >> "$LOGFILE" 2>&1
  ufw default allow outgoing >> "$LOGFILE" 2>&1

  # Allow SSH
  info "Allowing SSH on port $SSH_PORT..."
  ufw allow "$SSH_PORT/tcp" comment "SSH" >> "$LOGFILE" 2>&1
  ok "SSH port $SSH_PORT allowed"

  # Allow Gateway port
  info "Allowing Gateway on port $GATEWAY_PORT..."
  ufw allow "$GATEWAY_PORT/tcp" comment "HexOS Gateway" >> "$LOGFILE" 2>&1
  ok "Gateway port $GATEWAY_PORT allowed"

  # Enable
  echo "y" | ufw enable >> "$LOGFILE" 2>&1
  ok "UFW enabled"

  echo ""
  ufw status numbered
  echo ""

  SUMMARY_ITEMS+=("UFW Firewall: ✔ configured (SSH:$SSH_PORT, Gateway:$GATEWAY_PORT)")
  log "UFW configured: SSH=$SSH_PORT, Gateway=$GATEWAY_PORT"
}

# ── Step 2: SSH Hardening ───────────────────────────────────────────

harden_ssh() {
  step "SSH Hardening"

  local sshd_config="/etc/ssh/sshd_config"
  local changes_made=false

  # Check current state
  local pw_auth
  pw_auth=$(grep -E '^\s*PasswordAuthentication\s+' "$sshd_config" 2>/dev/null | awk '{print $2}' | tail -1)

  if [[ "$pw_auth" == "no" ]]; then
    ok "Password authentication is already disabled"
    SUMMARY_ITEMS+=("SSH Hardening: already hardened (skipped)")
    if ! confirm "SSH is already hardened. Re-apply settings?"; then
      return
    fi
  fi

  echo ""
  echo -e "  ${RED}${BOLD}⚠  WARNING ⚠${RESET}"
  echo -e "  ${YELLOW}This will disable SSH password authentication.${RESET}"
  echo -e "  ${YELLOW}Make sure you have SSH key access to this server!${RESET}"
  echo ""
  echo -e "  Test in another terminal: ${DIM}ssh root@$(hostname -I 2>/dev/null | awk '{print $1}' || echo 'your-ip')${RESET}"
  echo ""

  if ! confirm "Harden SSH configuration?"; then
    info "Skipping SSH hardening"
    SUMMARY_ITEMS+=("SSH Hardening: skipped")
    return
  fi

  # Backup
  if [[ ! -f "${sshd_config}.hexos-backup" ]]; then
    cp "$sshd_config" "${sshd_config}.hexos-backup"
    ok "Backed up sshd_config to ${sshd_config}.hexos-backup"
  fi

  # Disable password authentication
  if grep -qE '^\s*PasswordAuthentication\s+' "$sshd_config"; then
    sed -i 's/^\s*PasswordAuthentication\s\+.*/PasswordAuthentication no/' "$sshd_config"
  elif grep -qE '^\s*#\s*PasswordAuthentication\s+' "$sshd_config"; then
    sed -i 's/^\s*#\s*PasswordAuthentication\s\+.*/PasswordAuthentication no/' "$sshd_config"
  else
    echo "PasswordAuthentication no" >> "$sshd_config"
  fi
  changes_made=true
  ok "PasswordAuthentication set to no"

  # Disable root password login (keep key-based)
  if grep -qE '^\s*PermitRootLogin\s+' "$sshd_config"; then
    sed -i 's/^\s*PermitRootLogin\s\+.*/PermitRootLogin prohibit-password/' "$sshd_config"
  elif grep -qE '^\s*#\s*PermitRootLogin\s+' "$sshd_config"; then
    sed -i 's/^\s*#\s*PermitRootLogin\s\+.*/PermitRootLogin prohibit-password/' "$sshd_config"
  else
    echo "PermitRootLogin prohibit-password" >> "$sshd_config"
  fi
  ok "PermitRootLogin set to prohibit-password"

  # Disable empty passwords
  if grep -qE '^\s*PermitEmptyPasswords\s+' "$sshd_config"; then
    sed -i 's/^\s*PermitEmptyPasswords\s\+.*/PermitEmptyPasswords no/' "$sshd_config"
  elif grep -qE '^\s*#\s*PermitEmptyPasswords\s+' "$sshd_config"; then
    sed -i 's/^\s*#\s*PermitEmptyPasswords\s\+.*/PermitEmptyPasswords no/' "$sshd_config"
  else
    echo "PermitEmptyPasswords no" >> "$sshd_config"
  fi
  ok "PermitEmptyPasswords set to no"

  # Restart sshd
  if $changes_made; then
    if systemctl is-active --quiet sshd 2>/dev/null; then
      systemctl restart sshd
      ok "sshd restarted"
    elif systemctl is-active --quiet ssh 2>/dev/null; then
      systemctl restart ssh
      ok "ssh restarted"
    else
      warn "Could not restart SSH service — please restart manually"
    fi
  fi

  SUMMARY_ITEMS+=("SSH Hardening: ✔ password auth disabled, root password login disabled")
  log "SSH hardened: PasswordAuthentication=no, PermitRootLogin=prohibit-password"
}

# ── Step 3: Fail2ban ────────────────────────────────────────────────

setup_fail2ban() {
  step "Fail2ban"

  # Check if already installed and running
  if command -v fail2ban-client &>/dev/null && systemctl is-active --quiet fail2ban 2>/dev/null; then
    ok "Fail2ban is already installed and running"
    fail2ban-client status sshd 2>/dev/null || true
    echo ""
    if ! confirm "Fail2ban is already configured. Re-apply settings?"; then
      SUMMARY_ITEMS+=("Fail2ban: already active (skipped)")
      return
    fi
  fi

  if ! confirm "Install and configure Fail2ban?"; then
    info "Skipping Fail2ban"
    SUMMARY_ITEMS+=("Fail2ban: skipped")
    return
  fi

  # Install
  if ! command -v fail2ban-client &>/dev/null; then
    info "Installing fail2ban..."
    apt-get update -qq && apt-get install -y -qq fail2ban >> "$LOGFILE" 2>&1
    ok "fail2ban installed"
  fi

  # Configure jail
  local jail_local="/etc/fail2ban/jail.local"
  cat > "$jail_local" << EOF
# HexOS Fail2ban configuration
# Generated by hexos secure on $(date '+%Y-%m-%d %H:%M:%S')

[DEFAULT]
bantime  = 3600
findtime = 600
maxretry = 5

[sshd]
enabled  = true
port     = $SSH_PORT
filter   = sshd
logpath  = /var/log/auth.log
maxretry = 5
bantime  = 3600
EOF
  ok "Jail configured: max 5 retries, 1 hour ban (port $SSH_PORT)"

  # Enable and start
  systemctl enable fail2ban >> "$LOGFILE" 2>&1
  systemctl restart fail2ban >> "$LOGFILE" 2>&1
  ok "Fail2ban enabled and started"

  SUMMARY_ITEMS+=("Fail2ban: ✔ configured (5 retries, 1h ban on SSH)")
  log "Fail2ban configured: maxretry=5, bantime=3600, port=$SSH_PORT"
}

# ── Step 4: Auto Security Updates ───────────────────────────────────

setup_auto_updates() {
  step "Automatic Security Updates"

  # Check if already configured
  if dpkg -l unattended-upgrades &>/dev/null 2>&1 && \
     [[ -f /etc/apt/apt.conf.d/20auto-upgrades ]]; then
    ok "Unattended-upgrades is already installed"
    if ! confirm "Auto updates already configured. Re-apply settings?"; then
      SUMMARY_ITEMS+=("Auto Updates: already configured (skipped)")
      return
    fi
  fi

  if ! confirm "Enable automatic security updates?"; then
    info "Skipping auto updates"
    SUMMARY_ITEMS+=("Auto Updates: skipped")
    return
  fi

  # Install
  info "Installing unattended-upgrades..."
  apt-get update -qq && apt-get install -y -qq unattended-upgrades >> "$LOGFILE" 2>&1
  ok "unattended-upgrades installed"

  # Configure: security updates only
  cat > /etc/apt/apt.conf.d/50unattended-upgrades << 'EOF'
// HexOS auto-update configuration
Unattended-Upgrade::Allowed-Origins {
    "${distro_id}:${distro_codename}-security";
    "${distro_id}ESMApps:${distro_codename}-apps-security";
    "${distro_id}ESM:${distro_codename}-infra-security";
};

Unattended-Upgrade::AutoFixInterruptedDpkg "true";
Unattended-Upgrade::MinimalSteps "true";
Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
Unattended-Upgrade::Automatic-Reboot "false";
EOF

  # Enable auto-updates
  cat > /etc/apt/apt.conf.d/20auto-upgrades << 'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF

  ok "Security-only auto updates enabled"

  # Optional email notifications
  if ! $NON_INTERACTIVE; then
    echo ""
    read -rp "$(echo -e "${BOLD}Email for update notifications (leave empty to skip):${RESET} ")" notify_email
    if [[ -n "$notify_email" ]]; then
      sed -i '/Unattended-Upgrade::Mail /d' /etc/apt/apt.conf.d/50unattended-upgrades
      echo "Unattended-Upgrade::Mail \"$notify_email\";" >> /etc/apt/apt.conf.d/50unattended-upgrades
      echo "Unattended-Upgrade::MailReport \"on-change\";" >> /etc/apt/apt.conf.d/50unattended-upgrades
      ok "Email notifications enabled for $notify_email"
    fi
  fi

  systemctl enable unattended-upgrades >> "$LOGFILE" 2>&1
  systemctl restart unattended-upgrades >> "$LOGFILE" 2>&1

  SUMMARY_ITEMS+=("Auto Updates: ✔ security-only unattended upgrades enabled")
  log "Auto updates configured: security-only"
}

# ── Step 5: HexOS Service User ──────────────────────────────────────

setup_service_user() {
  step "HexOS Service User (optional)"

  # Check if user already exists
  if id hexos &>/dev/null; then
    ok "User 'hexos' already exists"
    if ! confirm "Service user exists. Reconfigure systemd service?"; then
      SUMMARY_ITEMS+=("Service User: already exists (skipped)")
      return
    fi
  fi

  echo -e "  ${DIM}Creates a dedicated 'hexos' system user and runs the gateway${RESET}"
  echo -e "  ${DIM}under that user instead of root for better isolation.${RESET}"
  echo ""

  if ! confirm "Create HexOS service user?" "N"; then
    info "Skipping service user creation"
    SUMMARY_ITEMS+=("Service User: skipped")
    return
  fi

  # Create system user
  if ! id hexos &>/dev/null; then
    useradd --system --create-home --home-dir /home/hexos --shell /bin/bash hexos
    ok "System user 'hexos' created"
  fi

  # Create config directory
  local hexos_home="/home/hexos"
  mkdir -p "$hexos_home/.config/hexos"
  chown -R hexos:hexos "$hexos_home"

  # Copy existing config if present
  local source_config=""
  if [[ -f /root/.config/clawdbot/config.yaml ]]; then
    source_config="/root/.config/clawdbot/config.yaml"
  elif [[ -f /root/.config/hexos/config.yaml ]]; then
    source_config="/root/.config/hexos/config.yaml"
  fi

  if [[ -n "$source_config" ]]; then
    if confirm "Copy existing config from $source_config to $hexos_home/.config/hexos/?"; then
      cp "$source_config" "$hexos_home/.config/hexos/config.yaml"
      chown hexos:hexos "$hexos_home/.config/hexos/config.yaml"
      chmod 600 "$hexos_home/.config/hexos/config.yaml"
      ok "Config copied to $hexos_home/.config/hexos/"
    fi
  fi

  # Create systemd service
  local service_file="/etc/systemd/system/hexos-gateway.service"
  local hexos_bin
  hexos_bin="$(command -v hexos 2>/dev/null || echo '/usr/local/bin/hexos')"

  cat > "$service_file" << EOF
[Unit]
Description=HexOS Gateway
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=hexos
Group=hexos
WorkingDirectory=$hexos_home
ExecStart=$hexos_bin gateway start --foreground
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
Environment=HOME=$hexos_home
Environment=NODE_ENV=production

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=$hexos_home
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  ok "Systemd service created at $service_file"
  info "Enable with: systemctl enable --now hexos-gateway"

  SUMMARY_ITEMS+=("Service User: ✔ 'hexos' user + systemd service created")
  log "Service user 'hexos' created with systemd service"
}

# ── Summary ──────────────────────────────────────────────────────────

print_summary() {
  echo ""
  echo -e "${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo -e "${BOLD}  Security Hardening Summary${RESET}"
  echo -e "${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo ""

  for item in "${SUMMARY_ITEMS[@]}"; do
    if [[ "$item" == *"✔"* ]]; then
      echo -e "  ${GREEN}$item${RESET}"
    elif [[ "$item" == *"skipped"* ]]; then
      echo -e "  ${DIM}$item${RESET}"
    else
      echo -e "  $item"
    fi
  done

  echo ""
  echo -e "  ${DIM}Log: $LOGFILE${RESET}"
  echo ""
  log "=== HexOS Secure completed ==="
}

# ── Main ─────────────────────────────────────────────────────────────

main() {
  banner
  preflight
  detect_ssh_port

  info "SSH port: $SSH_PORT"
  info "Gateway port: $GATEWAY_PORT"
  echo ""

  setup_ufw
  harden_ssh
  setup_fail2ban
  setup_auto_updates
  setup_service_user
  print_summary
}

main "$@"
