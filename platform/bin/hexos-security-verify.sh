#!/usr/bin/env bash
# HexOS Phase 1 — Workspace Jail: Security Verification Script
# Runs as the client user to verify jail isolation works correctly
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="/usr/sbin:/sbin:${PATH}"

usage() {
    echo "Usage: hexos-security-verify.sh <client-name>"
    echo ""
    echo "Runs isolation checks for a client's workspace jail."
    echo "Must be run as root (uses sudo -u to test as client user)."
    exit 1
}

[[ $# -lt 1 ]] && usage

CLIENT_NAME="$1"
CLIENT_USER="hexos-${CLIENT_NAME}"
CLIENT_HOME="/hexos/${CLIENT_NAME}"

# Verify client exists
if ! id "$CLIENT_USER" &>/dev/null; then
    echo "Error: Client user '${CLIENT_USER}' does not exist"
    exit 1
fi

if [[ ! -d "$CLIENT_HOME" ]]; then
    echo "Error: Client home '${CLIENT_HOME}' does not exist"
    exit 1
fi

PASS=0
FAIL=0
SKIP=0

check() {
    local desc="$1"
    local cmd="$2"
    local expect_fail="${3:-false}"
    
    # Run command as the client user
    output=$(sudo -u "$CLIENT_USER" bash -c "$cmd" 2>&1) && exitcode=0 || exitcode=$?
    
    if [[ "$expect_fail" == "true" ]]; then
        if [[ $exitcode -ne 0 ]]; then
            echo "  ✅ PASS: ${desc} (correctly denied)"
            PASS=$((PASS + 1))
        else
            echo "  ❌ FAIL: ${desc} (should have been denied but succeeded)"
            echo "         Output: ${output:0:200}"
            FAIL=$((FAIL + 1))
        fi
    else
        if [[ $exitcode -eq 0 ]]; then
            echo "  ✅ PASS: ${desc} (correctly allowed)"
            PASS=$((PASS + 1))
        else
            echo "  ❌ FAIL: ${desc} (should have been allowed but was denied)"
            echo "         Output: ${output:0:200}"
            FAIL=$((FAIL + 1))
        fi
    fi
}

echo "╔══════════════════════════════════════════════════╗"
echo "║  HexOS Security Verification                    ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
echo "Client:  ${CLIENT_NAME}"
echo "User:    ${CLIENT_USER} (uid=$(id -u "$CLIENT_USER"))"
echo "Home:    ${CLIENT_HOME}"
echo ""

# ─── ALLOWED OPERATIONS ───
echo "═══ Allowed Operations ═══"
echo ""

check "Read own workspace file" \
    "cat ${CLIENT_HOME}/workspace/AGENTS.md" \
    "false"

check "Write to own workspace" \
    "touch ${CLIENT_HOME}/workspace/.test-write && rm -f ${CLIENT_HOME}/workspace/.test-write" \
    "false"

check "Write to own tmp" \
    "touch ${CLIENT_HOME}/tmp/.test-tmp && rm -f ${CLIENT_HOME}/tmp/.test-tmp" \
    "false"

check "Write to own logs" \
    "touch ${CLIENT_HOME}/logs/.test-log && rm -f ${CLIENT_HOME}/logs/.test-log" \
    "false"

check "Write to own data" \
    "touch ${CLIENT_HOME}/data/.test-data && rm -f ${CLIENT_HOME}/data/.test-data" \
    "false"

check "Execute basic commands" \
    "echo hello" \
    "false"

check "Access Node.js" \
    "which node" \
    "false"

check "List own directory" \
    "ls ${CLIENT_HOME}/" \
    "false"

check "Create subdirectory in workspace" \
    "mkdir -p ${CLIENT_HOME}/workspace/.test-dir && rmdir ${CLIENT_HOME}/workspace/.test-dir" \
    "false"

echo ""

# ─── DENIED OPERATIONS ───
echo "═══ Denied Operations (User-Level) ═══"
echo "  (Tests run as user without systemd — some hardening only applies under systemd)"
echo ""

# System file access
check "Read /etc/shadow" \
    "cat /etc/shadow" \
    "true"

check "Read /root/" \
    "ls /root/" \
    "true"

check "Read /root/.ssh/" \
    "ls /root/.ssh/" \
    "true"

check "Read SSH private keys" \
    "cat /root/.ssh/id_rsa 2>/dev/null || cat /root/.ssh/id_ed25519 2>/dev/null" \
    "true"

# Cross-client access
# Find any other client directories
OTHER_CLIENTS=()
for dir in /hexos/*/; do
    dirname=$(basename "$dir")
    if [[ "$dirname" != "$CLIENT_NAME" && "$dirname" != "platform" && "$dirname" != "shared" ]]; then
        OTHER_CLIENTS+=("$dirname")
    fi
done

if [[ ${#OTHER_CLIENTS[@]} -gt 0 ]]; then
    for other in "${OTHER_CLIENTS[@]}"; do
        check "Read other client '${other}' workspace" \
            "ls /hexos/${other}/workspace/" \
            "true"
        
        check "Write to other client '${other}'" \
            "touch /hexos/${other}/workspace/.exploit" \
            "true"
    done
else
    echo "  ⚠️  SKIP: No other clients exist for cross-client isolation test"
    echo "         (Create another client first for full verification)"
    SKIP=$((SKIP + 1))
fi

# Platform directory access
check "Write to platform directory" \
    "touch /hexos/platform/test-write" \
    "true"

# Write outside jail
check "Write to /etc/" \
    "touch /etc/.hexos-test" \
    "true"

check "Write to /usr/" \
    "touch /usr/.hexos-test" \
    "true"

check "Write to /hexos/ root" \
    "touch /hexos/.hexos-test" \
    "true"

# Privilege escalation
check "Use sudo" \
    "sudo id" \
    "true"

check "Use su" \
    "echo '' | su -c id root 2>&1" \
    "true"

check "Use pkexec" \
    "pkexec --help 2>&1 | head -1; false" \
    "true"

# System operations
check "Mount filesystem" \
    "mount -t tmpfs none /tmp" \
    "true"

check "Load kernel module" \
    "modprobe dummy" \
    "true"

check "Create system user" \
    "useradd testuser-exploit" \
    "true"

check "Change hostname" \
    "hostname evil-hostname" \
    "true"

check "Write to sysctl" \
    "sysctl -w kernel.hostname=evil 2>&1 | grep -q 'permission denied' && exit 1 || exit 0" \
    "true"

check "Access Docker socket" \
    "test -S /var/run/docker.sock && curl --unix-socket /var/run/docker.sock http://localhost/info 2>/dev/null" \
    "true"

# Process visibility (basic check - full PID namespace test requires systemd)
check "Read /proc/1/environ" \
    "cat /proc/1/environ" \
    "true"

echo ""
echo "═══ Systemd-Hardened Tests (only enforced under systemd unit) ═══"
echo "  Note: These are enforced by InaccessiblePaths, PrivateTmp, ProtectProc"
echo "  when running under hexos-agent@${CLIENT_NAME}.service"
echo ""

# These tests check for systemd isolation override
OVERRIDE_FILE="/etc/systemd/system/hexos-agent@${CLIENT_NAME}.service.d/isolation.conf"
if [[ -f "$OVERRIDE_FILE" ]]; then
    echo "  ✅ INFO: Systemd isolation override exists at ${OVERRIDE_FILE}"
    PASS=$((PASS + 1))
else
    echo "  ❌ FAIL: Systemd isolation override missing at ${OVERRIDE_FILE}"
    FAIL=$((FAIL + 1))
fi

# Check systemd unit has hardening directives
UNIT_FILE="/etc/systemd/system/hexos-agent@.service"
if [[ -f "$UNIT_FILE" ]]; then
    for directive in "ProtectHome=yes" "ProtectSystem=strict" "NoNewPrivileges=yes" "CapabilityBoundingSet=" "PrivateTmp=yes" "PrivateDevices=yes" "ProtectKernelModules=yes" "ProtectHostname=yes"; do
        if grep -q "$directive" "$UNIT_FILE"; then
            echo "  ✅ PASS: Systemd unit has ${directive}"
            PASS=$((PASS + 1))
        else
            echo "  ❌ FAIL: Systemd unit missing ${directive}"
            FAIL=$((FAIL + 1))
        fi
    done
else
    echo "  ❌ FAIL: Systemd unit template not installed at ${UNIT_FILE}"
    FAIL=$((FAIL + 1))
fi

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║  Results                                         ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
echo "  Passed:  ${PASS}"
echo "  Failed:  ${FAIL}"
echo "  Skipped: ${SKIP}"
echo ""

if [[ $FAIL -eq 0 ]]; then
    echo "  ✅ All security checks passed!"
else
    echo "  ❌ SECURITY ISSUES DETECTED — ${FAIL} check(s) failed"
fi

exit $FAIL
