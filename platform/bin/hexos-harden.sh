#!/usr/bin/env bash
set -euo pipefail
# HexOS Server Hardening Script
# Hardens a fresh Ubuntu server for running HexOS gateways.
# Safe to run multiple times (idempotent).
#
# Usage: hexos-harden.sh [--reboot]
#   --reboot   Reboot at the end if kernel updates are pending

REBOOT_FLAG="${1:-}"
LOGFILE="/var/log/hexos-harden.log"

log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOGFILE"; }

log "═══ HexOS Server Hardening ═══"
log "Host: $(hostname)"
log "Date: $(date)"

# ──────────────────────────────────────
# 1. SSH HARDENING
# ──────────────────────────────────────
log ""
log "━━━ 1. SSH Hardening ━━━"

SSHD_CONFIG="/etc/ssh/sshd_config"
SSHD_DROP="/etc/ssh/sshd_config.d/99-hexos-hardening.conf"

mkdir -p /etc/ssh/sshd_config.d

cat > "$SSHD_DROP" << 'EOF'
# HexOS Server Hardening — SSH
# Applied by hexos-harden.sh

PermitRootLogin prohibit-password
PasswordAuthentication no
KbdInteractiveAuthentication no
X11Forwarding no
MaxAuthTries 3
LoginGraceTime 30
ClientAliveInterval 300
ClientAliveCountMax 2
AllowAgentForwarding no
AllowTcpForwarding no
EOF

# Verify sshd config is valid before restarting
if sshd -t 2>/dev/null; then
    systemctl reload sshd 2>/dev/null || systemctl reload ssh 2>/dev/null || true
    log "  ✅ SSH hardened (password auth OFF, root=prohibit-password, max 3 tries)"
else
    rm -f "$SSHD_DROP"
    log "  ❌ SSH config invalid — reverted. CHECK MANUALLY."
    exit 1
fi

# ──────────────────────────────────────
# 2. FIREWALL (UFW)
# ──────────────────────────────────────
log ""
log "━━━ 2. Firewall (UFW) ━━━"

apt-get install -y ufw > /dev/null 2>&1

# Reset to defaults
ufw --force reset > /dev/null 2>&1

# Default policies
ufw default deny incoming > /dev/null 2>&1
ufw default allow outgoing > /dev/null 2>&1

# Allow SSH (critical — don't lock ourselves out)
ufw allow 22/tcp comment 'SSH' > /dev/null 2>&1

# Allow HTTP/HTTPS for potential webhook/API use
ufw allow 80/tcp comment 'HTTP' > /dev/null 2>&1
ufw allow 443/tcp comment 'HTTPS' > /dev/null 2>&1

# Enable (non-interactive)
ufw --force enable > /dev/null 2>&1

log "  ✅ UFW enabled (deny incoming, allow SSH/HTTP/HTTPS)"
ufw status numbered 2>/dev/null | sed 's/^/  /' | tee -a "$LOGFILE"

# ──────────────────────────────────────
# 3. FAIL2BAN
# ──────────────────────────────────────
log ""
log "━━━ 3. Fail2Ban ━━━"

apt-get install -y fail2ban > /dev/null 2>&1

cat > /etc/fail2ban/jail.local << 'EOF'
# HexOS Server Hardening — Fail2Ban
[DEFAULT]
bantime = 1h
findtime = 10m
maxretry = 5
backend = systemd

[sshd]
enabled = true
port = ssh
maxretry = 3
bantime = 24h
EOF

systemctl enable fail2ban > /dev/null 2>&1
systemctl restart fail2ban
log "  ✅ Fail2Ban installed (SSH: 3 tries → 24h ban)"

# ──────────────────────────────────────
# 4. SYSCTL HARDENING
# ──────────────────────────────────────
log ""
log "━━━ 4. Sysctl Hardening ━━━"

cat > /etc/sysctl.d/99-hexos-hardening.conf << 'EOF'
# HexOS Server Hardening — Kernel parameters

# Disable ICMP redirects
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv6.conf.all.accept_redirects = 0
net.ipv6.conf.default.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.default.send_redirects = 0

# Disable source routing
net.ipv4.conf.all.accept_source_route = 0
net.ipv4.conf.default.accept_source_route = 0
net.ipv6.conf.all.accept_source_route = 0
net.ipv6.conf.default.accept_source_route = 0

# Log martian packets
net.ipv4.conf.all.log_martians = 1
net.ipv4.conf.default.log_martians = 1

# SYN flood protection (already on by default, enforce)
net.ipv4.tcp_syncookies = 1

# Disable IP forwarding (not a router)
net.ipv4.ip_forward = 0
net.ipv6.conf.all.forwarding = 0

# Ignore ICMP broadcasts
net.ipv4.icmp_echo_ignore_broadcasts = 1

# Ignore bogus ICMP errors
net.ipv4.icmp_ignore_bogus_error_responses = 1

# Reverse path filtering
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1

# ASLR
kernel.randomize_va_space = 2

# Restrict dmesg
kernel.dmesg_restrict = 1

# Restrict kernel pointers
kernel.kptr_restrict = 2

# Harden BPF JIT
net.core.bpf_jit_harden = 2
EOF

sysctl --system > /dev/null 2>&1
log "  ✅ Sysctl hardened (ICMP redirects off, martians logged, RP filter on, BPF hardened)"

# ──────────────────────────────────────
# 5. SWAP (2GB, prevent OOM kills)
# ──────────────────────────────────────
log ""
log "━━━ 5. Swap ━━━"

if swapon --show | grep -q '/swapfile'; then
    log "  ✅ Swap already configured"
else
    if [ ! -f /swapfile ]; then
        fallocate -l 2G /swapfile
        chmod 600 /swapfile
        mkswap /swapfile > /dev/null 2>&1
    fi
    swapon /swapfile 2>/dev/null || true
    if ! grep -q '/swapfile' /etc/fstab; then
        echo '/swapfile none swap sw 0 0' >> /etc/fstab
    fi
    # Low swappiness — only use swap under pressure
    sysctl vm.swappiness=10 > /dev/null 2>&1
    echo 'vm.swappiness=10' >> /etc/sysctl.d/99-hexos-hardening.conf
    log "  ✅ 2GB swap created (swappiness=10)"
fi

# ──────────────────────────────────────
# 6. AUTO-REBOOT FOR SECURITY UPDATES
# ──────────────────────────────────────
log ""
log "━━━ 6. Auto-Reboot Config ━━━"

# Enable auto-reboot at 4 AM for pending kernel updates
UNATTENDED_CONF="/etc/apt/apt.conf.d/51hexos-autoreboot"
cat > "$UNATTENDED_CONF" << 'EOF'
// HexOS: Auto-reboot for security kernel updates
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:00";
Unattended-Upgrade::Automatic-Reboot-WithUsers "true";
EOF
log "  ✅ Auto-reboot enabled (4 AM when kernel updates pending)"

# ──────────────────────────────────────
# 7. MISC HARDENING
# ──────────────────────────────────────
log ""
log "━━━ 7. Misc ━━━"

# Restrict cron to root
echo "root" > /etc/cron.allow 2>/dev/null || true
log "  ✅ Cron restricted to root"

# Secure shared memory
if ! grep -q 'tmpfs /run/shm' /etc/fstab; then
    echo 'tmpfs /run/shm tmpfs defaults,noexec,nosuid 0 0' >> /etc/fstab
    log "  ✅ Shared memory hardened (noexec,nosuid)"
else
    log "  ✅ Shared memory already hardened"
fi

# ──────────────────────────────────────
# SUMMARY
# ──────────────────────────────────────
log ""
log "══════════════════════════════════════════"
log "  HARDENING COMPLETE"
log "══════════════════════════════════════════"
log ""
log "  ✅ SSH: password auth OFF, max 3 tries"
log "  ✅ Firewall: UFW active (SSH/HTTP/HTTPS only)"
log "  ✅ Fail2Ban: SSH 3 tries → 24h ban"
log "  ✅ Sysctl: ICMP/redirects/martians/RP filter/BPF"
log "  ✅ Swap: 2GB (OOM protection)"
log "  ✅ Auto-reboot: 4 AM for kernel updates"
log "  ✅ Cron: root only"
log "  ✅ Shared memory: hardened"
log ""
log "  Log: $LOGFILE"

if [ -f /var/run/reboot-required ]; then
    log ""
    log "  ⚠️  REBOOT REQUIRED for pending kernel update"
    if [ "$REBOOT_FLAG" = "--reboot" ]; then
        log "  Rebooting in 10 seconds..."
        sleep 10
        reboot
    else
        log "  Run: sudo reboot (or re-run with --reboot)"
    fi
fi
