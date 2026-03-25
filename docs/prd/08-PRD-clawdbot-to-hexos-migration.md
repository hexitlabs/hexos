# PRD 08 — Markus Server: Clawdbot → HexOS Migration

*Version: 3.0 · March 25, 2026*
*Status: Approved*
*Scope: Markus's server ONLY (EEVEELUTIONS — 204.168.157.39)*

---

## Overview

Migrate Markus's server from Clawdbot (`2026.1.24-3`) to HexOS (`@hexitlabs/hexos@2026.1.24-18`). Two gateways: **Eevee** (main agent) and **Mew** (therapist). Both must work identically after migration.

---

## Investigation Results (Source Code Verified)

### HexOS Has ZERO Backward Compatibility with Clawdbot Naming

Verified by grepping the entire HexOS dist directory on Steve's server:

| What | Clawdbot | HexOS | Backward compat? |
|------|----------|-------|-------------------|
| Config dir | `~/.clawdbot/` | `~/.hexos/` | ❌ None — hardcoded in `utils.js`: `path.join(homedir(), ".hexos")` |
| Config file | `clawdbot.json` | `hexos.json` | ❌ None — set in `profile.js`: `path.join(stateDir, "hexos.json")` |
| Env vars | `CLAWDBOT_*` | `HEXOS_*` | ❌ None — only `HEXOS_*` in source. Zero `CLAWDBOT` references. |
| Binary | `clawdbot` | `hexos` | ❌ Different npm package name |
| Process name | `clawdbot-gateway` | `hexos-gateway` | ❌ Set in `entry.js`: `process.title = "hexos"` |
| Systemd service | `clawdbot-gateway` | `hexos-gateway` | ❌ Hardcoded in `constants.js` |
| Profile suffix | `~/.clawdbot-<profile>/` | `~/.hexos-<profile>/` | ❌ Built from `.hexos` prefix |

**Conclusion:** We MUST create new config dirs, new service files, and use new env vars. No shortcuts.

### HexOS Config Resolution Order (from source)

1. If `HEXOS_STATE_DIR` env var is set → use that
2. If `--profile <name>` flag → `~/.hexos-<name>/`
3. Default → `~/.hexos/`
4. Config file: `<stateDir>/hexos.json`
5. Override: `HEXOS_CONFIG_PATH` env var

### Config File Format

`hexos.json` is the **exact same JSON format** as `clawdbot.json`. Only the filename differs. Verified by comparing Steve's configs — identical schema.

---

## Current State: Markus's Server

### Server
- **Hostname:** EEVEELUTIONS
- **IP:** 204.168.157.39 / 2a01:4f9:c014:811::1
- **Node.js:** v22.22.1
- **Current package:** `clawdbot@2026.1.24-3`
- **Ollama:** Active, `nomic-embed-text` loaded

### Gateway 1: Eevee (Main Agent)

| Property | Value |
|----------|-------|
| Config | `/root/.clawdbot/clawdbot.json` (262 lines) |
| State | `/root/.clawdbot/` (12MB — sessions, agents, cron, identity, telegram) |
| Workspace | `/root/clawd/` (SOUL.md, MEMORY.md, HEARTBEAT.md) |
| Port | 18789 |
| Systemd | `~/.config/systemd/user/clawdbot-gateway.service` |
| Sub-agents | `main`, `radar` (workspace: `/root/clawd-radar/`) |
| Session files | 2 JSONL transcripts |
| Cron | `jobs.json` + backup |

**LLM Stack:**
```
Primary:    anthropic/claude-opus-4-6
Fallback 1: nvidia/nvidia/nemotron-3-super-120b-a12b
Fallback 2: anthropic/claude-sonnet-4-6
Fallback 3: moonshot/kimi-k2.5
Fallback 4: moonshot/kimi-k2-0905-preview

Heartbeat model:  anthropic/claude-sonnet-4-6
Subagent model:   anthropic/claude-sonnet-4-6
```

**3 API Providers:**
- Anthropic — OAuth token auth, Opus + Sonnet
- NVIDIA NIM — API key, Nemotron 3 Super 120B
- Moonshot — API key, Kimi K2 + K2.5

**Memory:** Ollama `nomic-embed-text` at `localhost:11434`, session memory enabled

**Key settings:** Context 1M tokens, compaction safeguard + memoryFlush, heartbeat 1h, max concurrent 4, session reset after 480min idle, exec security full, gateway bind loopback with auth token, Brave API key in systemd env.

### Gateway 2: Mew (Therapist)

| Property | Value |
|----------|-------|
| Config | `/root/.clawdbot-mew/clawdbot.json` |
| State | `/root/.clawdbot-mew/` (4.9MB) |
| Workspace | `/root/therapist/` (SOUL.md, HEARTBEAT.md) |
| Port | 18795 |
| Systemd | `~/.config/systemd/user/clawdbot-gateway-mew.service` |
| Sub-agents | None |
| Session files | 3 JSONL transcripts |
| Cron | `jobs.json` + backup |

**LLM Stack:**
```
Primary:    anthropic/claude-opus-4-6
Fallback 1: moonshot/kimi-k2.5

Thinking: high (default)
```

**2 API Providers:**
- Anthropic — OAuth token, Opus only
- Moonshot — API key, Kimi K2.5

**Key settings:** Context 1M, compaction safeguard, heartbeat 1h, max concurrent 1, session reset daily at 21:00, Telegram allowlist (Markus: `6013499331`), groups disabled, `CLAWDBOT_ALLOW_MULTI_GATEWAY=1`.

---

## Migration Procedure

### Pre-Flight (2 min)

```bash
# Verify access
ssh root@204.168.157.39 "hostname && clawdbot --version"
# → EEVEELUTIONS / 2026.1.24-3

# Verify both gateways running
ssh root@204.168.157.39 "systemctl --user is-active clawdbot-gateway clawdbot-gateway-mew"
# → active / active

# Verify Ollama
ssh root@204.168.157.39 "curl -s http://localhost:11434/api/tags | grep nomic"
# → nomic-embed-text

# BACKUP EVERYTHING
ssh root@204.168.157.39 bash << 'EOF'
STAMP=$(date +%Y%m%d%H%M)
cp -a /root/.clawdbot "/root/.clawdbot.bak.$STAMP"
cp -a /root/.clawdbot-mew "/root/.clawdbot-mew.bak.$STAMP"
cp ~/.config/systemd/user/clawdbot-gateway.service ~/.config/systemd/user/clawdbot-gateway.service.bak
cp ~/.config/systemd/user/clawdbot-gateway-mew.service ~/.config/systemd/user/clawdbot-gateway-mew.service.bak
echo "✅ Backups created with stamp $STAMP"
EOF
```

### Step 1: Stop Gateways (10 sec)

```bash
ssh root@204.168.157.39 bash << 'EOF'
systemctl --user stop clawdbot-gateway-mew
systemctl --user stop clawdbot-gateway
sleep 2
# Confirm stopped
if ps aux | grep -E 'clawdbot-gateway' | grep -v grep > /dev/null; then
    echo "⚠️ GATEWAYS STILL RUNNING — ABORT"
    exit 1
fi
echo "✅ Both gateways stopped"
EOF
```

⏱️ **Downtime starts. Telegram messages will queue.**

### Step 2: Install HexOS (30 sec)

```bash
ssh root@204.168.157.39 bash << 'EOF'
npm install -g @hexitlabs/hexos

# Verify
HEXOS_VER=$(hexos --version 2>/dev/null)
if [ "$HEXOS_VER" != "2026.1.24-18" ]; then
    echo "⚠️ WRONG VERSION: $HEXOS_VER — ABORT"
    exit 1
fi

echo "✅ HexOS $HEXOS_VER installed at $(which hexos)"
echo "   Entry: $(ls /usr/lib/node_modules/@hexitlabs/hexos/dist/entry.js)"
EOF
```

### Step 3: Migrate Eevee Config (1 min)

```bash
ssh root@204.168.157.39 bash << 'EOF'
set -e

# Create new state directory
mkdir -p /root/.hexos

# Copy config file (rename to hexos.json)
cp /root/.clawdbot/clawdbot.json /root/.hexos/hexos.json

# Copy ALL state subdirectories
for item in agents cron devices identity telegram sessions update-check.json; do
    src="/root/.clawdbot/$item"
    if [ -e "$src" ]; then
        cp -a "$src" "/root/.hexos/$item"
        echo "  Copied: $item"
    fi
done

# Copy any remaining state files (json, bak)
for f in /root/.clawdbot/*.json.bak; do
    [ -f "$f" ] && cp -a "$f" "/root/.hexos/" && echo "  Copied: $(basename $f)"
done

# Verify config integrity — check model fallbacks are intact
PRIMARY=$(grep -o '"primary": "[^"]*"' /root/.hexos/hexos.json | head -1)
FALLBACK_COUNT=$(grep -c '"nvidia/nvidia/nemotron\|claude-sonnet\|kimi-k2' /root/.hexos/hexos.json)

echo ""
echo "✅ Eevee config migrated to /root/.hexos/"
echo "   Primary model: $PRIMARY"
echo "   Fallback references found: $FALLBACK_COUNT (expected: 6+)"
echo "   Files:"
ls -la /root/.hexos/
EOF
```

### Step 4: Migrate Mew Config (1 min)

```bash
ssh root@204.168.157.39 bash << 'EOF'
set -e

# Create new state directory (profile suffix = -mew)
mkdir -p /root/.hexos-mew

# Copy config file
cp /root/.clawdbot-mew/clawdbot.json /root/.hexos-mew/hexos.json

# Copy ALL state subdirectories
for item in agents cron devices identity telegram sessions update-check.json; do
    src="/root/.clawdbot-mew/$item"
    if [ -e "$src" ]; then
        cp -a "$src" "/root/.hexos-mew/$item"
        echo "  Copied: $item"
    fi
done

# Copy remaining state files
for f in /root/.clawdbot-mew/*.json.bak; do
    [ -f "$f" ] && cp -a "$f" "/root/.hexos-mew/" && echo "  Copied: $(basename $f)"
done

# Verify config integrity
PRIMARY=$(grep -o '"primary": "[^"]*"' /root/.hexos-mew/hexos.json | head -1)
ALLOWFROM=$(grep -o '"6013499331"' /root/.hexos-mew/hexos.json)

echo ""
echo "✅ Mew config migrated to /root/.hexos-mew/"
echo "   Primary model: $PRIMARY"
echo "   Markus allowlist: $ALLOWFROM"
echo "   Files:"
ls -la /root/.hexos-mew/
EOF
```

### Step 5: Create New Systemd Services (1 min)

**Eevee:**
```bash
ssh root@204.168.157.39 bash << 'OUTER'
cat > ~/.config/systemd/user/hexos-gateway.service << 'EOF'
[Unit]
Description=HexOS Gateway — Eevee (v2026.1.24-18)
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=/usr/bin/node /usr/lib/node_modules/@hexitlabs/hexos/dist/entry.js gateway --port 18789
Restart=always
RestartSec=5
KillMode=process
Environment=HOME=/root
Environment="PATH=/root/.local/bin:/root/.npm-global/bin:/root/bin:/root/.nvm/current/bin:/root/.fnm/current/bin:/root/.volta/bin:/root/.asdf/shims:/root/.local/share/pnpm:/root/.bun/bin:/usr/local/bin:/usr/bin:/bin"
Environment=HEXOS_GATEWAY_PORT=18789
Environment=HEXOS_GATEWAY_TOKEN=c5557fa9829dc2624ff5f7cbfc9697c7300ddc9a6c5e8f96
Environment=HEXOS_SYSTEMD_UNIT=hexos-gateway.service
Environment=HEXOS_SERVICE_MARKER=hexos
Environment=HEXOS_SERVICE_KIND=gateway
Environment=HEXOS_SERVICE_VERSION=2026.1.24-18
Environment=BRAVE_API_KEY=BSAOdyOFxUvCpj2l_yZ9Jhv2UaOa3KQ

[Install]
WantedBy=default.target
EOF
echo "✅ Created hexos-gateway.service"
OUTER
```

**Mew:**
```bash
ssh root@204.168.157.39 bash << 'OUTER'
cat > ~/.config/systemd/user/hexos-gateway-mew.service << 'EOF'
[Unit]
Description=HexOS Gateway — Mew (Therapist Companion)
After=network-online.target hexos-gateway.service
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/node /usr/lib/node_modules/@hexitlabs/hexos/dist/entry.js gateway --port 18795
Environment=HEXOS_PROFILE=mew
Environment=HEXOS_CONFIG_PATH=/root/.hexos-mew/hexos.json
Environment=HEXOS_STATE_DIR=/root/.hexos-mew
Environment=HEXOS_GATEWAY_PORT=18795
Environment=HEXOS_SERVICE_MARKER=hexos-mew
Environment=HEXOS_SYSTEMD_UNIT=hexos-gateway-mew.service
Environment=HEXOS_ALLOW_MULTI_GATEWAY=1
WorkingDirectory=/root/therapist
Restart=on-failure
RestartSec=30

[Install]
WantedBy=default.target
EOF
echo "✅ Created hexos-gateway-mew.service"
OUTER
```

### Step 6: Swap Services (30 sec)

```bash
ssh root@204.168.157.39 bash << 'EOF'
systemctl --user daemon-reload
systemctl --user disable clawdbot-gateway.service 2>/dev/null
systemctl --user disable clawdbot-gateway-mew.service 2>/dev/null
systemctl --user enable hexos-gateway.service
systemctl --user enable hexos-gateway-mew.service
echo "✅ Old disabled, new enabled"
EOF
```

### Step 7: Start Eevee + Verify (1 min)

```bash
ssh root@204.168.157.39 bash << 'EOF'
systemctl --user start hexos-gateway
sleep 5

# Check 1: Service running
STATUS=$(systemctl --user is-active hexos-gateway)
if [ "$STATUS" != "active" ]; then
    echo "❌ FAIL: Eevee not running (status: $STATUS)"
    echo "Logs:"
    journalctl --user -u hexos-gateway --no-pager -n 30
    exit 1
fi

# Check 2: Process is hexos (not clawdbot)
if ! ps aux | grep 'hexos-gateway' | grep -v grep > /dev/null; then
    echo "❌ FAIL: No hexos-gateway process"
    exit 1
fi

# Check 3: HTTP health check
HTTP=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:18789/healthz 2>/dev/null)
if [ "$HTTP" != "200" ]; then
    echo "❌ FAIL: Health check returned $HTTP"
    exit 1
fi

# Check 4: Telegram connected
sleep 3
if journalctl --user -u hexos-gateway --no-pager -n 50 | grep -qi 'telegram.*connect\|polling\|webhook'; then
    echo "  ✅ Telegram appears connected"
else
    echo "  ⚠️ Telegram connection not confirmed in logs — check manually"
fi

echo "✅ Eevee (hexos-gateway) is LIVE on port 18789"
EOF
```

### Step 8: Start Mew + Verify (1 min)

```bash
ssh root@204.168.157.39 bash << 'EOF'
systemctl --user start hexos-gateway-mew
sleep 5

# Check 1: Service running
STATUS=$(systemctl --user is-active hexos-gateway-mew)
if [ "$STATUS" != "active" ]; then
    echo "❌ FAIL: Mew not running (status: $STATUS)"
    echo "Logs:"
    journalctl --user -u hexos-gateway-mew --no-pager -n 30
    exit 1
fi

# Check 2: HTTP health
HTTP=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:18795/healthz 2>/dev/null)
if [ "$HTTP" != "200" ]; then
    echo "❌ FAIL: Mew health check returned $HTTP"
    exit 1
fi

# Check 3: Telegram connected
sleep 3
if journalctl --user -u hexos-gateway-mew --no-pager -n 50 | grep -qi 'telegram.*connect\|polling\|webhook'; then
    echo "  ✅ Telegram appears connected"
else
    echo "  ⚠️ Telegram connection not confirmed — check manually"
fi

echo "✅ Mew (hexos-gateway-mew) is LIVE on port 18795"
EOF
```

⏱️ **Downtime ends.**

### Step 9: Full Verification (3 min)

```bash
ssh root@204.168.157.39 bash << 'EOF'
echo "═══════════════════════════════════════════"
echo "  POST-MIGRATION VERIFICATION"
echo "═══════════════════════════════════════════"
echo ""

# 1. Package version
echo "1. Package version"
echo "   $(hexos --version 2>/dev/null)"

# 2. Processes
echo ""
echo "2. Running processes"
ps aux | grep -E 'hexos|clawdbot' | grep -v grep | awk '{print "   "$11" "$12" "$13}'
CLAWDBOT_PROCS=$(ps aux | grep 'clawdbot' | grep -v grep | wc -l)
if [ "$CLAWDBOT_PROCS" -gt 0 ]; then
    echo "   ❌ WARNING: $CLAWDBOT_PROCS clawdbot processes still running!"
fi

# 3. Services
echo ""
echo "3. Service status"
echo "   hexos-gateway:     $(systemctl --user is-active hexos-gateway)"
echo "   hexos-gateway-mew: $(systemctl --user is-active hexos-gateway-mew)"

# 4. Health checks
echo ""
echo "4. Health checks"
echo "   Eevee (18789): HTTP $(curl -s -o /dev/null -w '%{http_code}' http://localhost:18789/healthz)"
echo "   Mew   (18795): HTTP $(curl -s -o /dev/null -w '%{http_code}' http://localhost:18795/healthz)"

# 5. Eevee LLM config
echo ""
echo "5. Eevee LLM config"
echo "   Primary: $(grep -o '"primary": "[^"]*"' /root/.hexos/hexos.json | head -1)"
echo "   Fallbacks:"
grep -o '"nvidia/nvidia/nemotron-3-super-120b-a12b"\|"anthropic/claude-sonnet-4-6"\|"moonshot/kimi-k2.5"\|"moonshot/kimi-k2-0905-preview"' /root/.hexos/hexos.json | sort -u | while read f; do echo "     $f"; done
echo "   Providers:"
grep -o '"baseUrl": "[^"]*"' /root/.hexos/hexos.json | while read u; do echo "     $u"; done

# 6. Mew LLM config
echo ""
echo "6. Mew LLM config"
echo "   Primary: $(grep -o '"primary": "[^"]*"' /root/.hexos-mew/hexos.json | head -1)"
echo "   Fallbacks:"
grep -o '"moonshot/kimi-k2.5"' /root/.hexos-mew/hexos.json | head -1 | while read f; do echo "     $f"; done
echo "   Telegram allowlist: $(grep -o '"6013499331"' /root/.hexos-mew/hexos.json)"

# 7. Memory search
echo ""
echo "7. Ollama (memory search)"
echo "   Status: $(systemctl is-active ollama)"
echo "   Model: $(curl -s http://localhost:11434/api/tags | grep -o '"name":"[^"]*"' | head -1)"

# 8. Workspace files
echo ""
echo "8. Workspace files"
for f in /root/clawd/SOUL.md /root/clawd/MEMORY.md /root/clawd/HEARTBEAT.md /root/therapist/SOUL.md /root/therapist/HEARTBEAT.md; do
    [ -f "$f" ] && echo "   ✅ $f" || echo "   ❌ MISSING: $f"
done

# 9. Cron jobs
echo ""
echo "9. Cron jobs"
echo "   Eevee: $(cat /root/.hexos/cron/jobs.json 2>/dev/null | grep -c '"id"') jobs"
echo "   Mew:   $(cat /root/.hexos-mew/cron/jobs.json 2>/dev/null | grep -c '"id"') jobs"

echo ""
echo "═══════════════════════════════════════════"
echo "  MANUAL CHECKS REQUIRED:"
echo "  □ Send a message to Eevee's Telegram bot"
echo "  □ Send a message to Mew's Telegram bot"
echo "  □ Verify Eevee responds with correct personality"
echo "  □ Verify Mew responds (as Markus, ID 6013499331)"
echo "═══════════════════════════════════════════"
EOF
```

---

## Rollback (30 seconds)

If ANYTHING fails at ANY step:

```bash
ssh root@204.168.157.39 bash << 'EOF'
# Stop new services (ignore errors)
systemctl --user stop hexos-gateway hexos-gateway-mew 2>/dev/null

# Re-enable old services
systemctl --user enable clawdbot-gateway.service clawdbot-gateway-mew.service 2>/dev/null

# Start old services
systemctl --user start clawdbot-gateway
systemctl --user start clawdbot-gateway-mew

# Verify rollback
sleep 3
echo "clawdbot-gateway: $(systemctl --user is-active clawdbot-gateway)"
echo "clawdbot-gateway-mew: $(systemctl --user is-active clawdbot-gateway-mew)"
echo "✅ Rolled back to Clawdbot"
EOF
```

**Why rollback works:** We COPY configs (never move), we don't uninstall clawdbot, old service files are backed up. Original state dirs (`/root/.clawdbot/`, `/root/.clawdbot-mew/`) are completely untouched.

---

### Step 10: Deploy HexOS Operator Mode (2 min)

After both gateways are verified running on HexOS, deploy the platform scripts and activate operator mode.

```bash
ssh root@204.168.157.39 bash << 'EOF'
set -e

# Create platform directory structure
mkdir -p /hexos/platform/{bin,config,templates,security,network,audit}
mkdir -p /hexos/shared/{skills,bin}

echo "✅ Platform directories created"
EOF
```

```bash
# Copy platform scripts from our repo to Markus's server
scp -r ~/clawd/repos/hexos/platform/* root@204.168.157.39:/hexos/platform/
scp ~/clawd/repos/hexos/scripts/hexos root@204.168.157.39:/usr/local/bin/hexos-platform

# Make all scripts executable
ssh root@204.168.157.39 "chmod +x /hexos/platform/bin/*.sh /hexos/platform/security/*.sh /hexos/platform/network/*.sh /hexos/platform/audit/*.sh /usr/local/bin/hexos-platform 2>/dev/null; echo '✅ Scripts deployed and executable'"
```

```bash
ssh root@204.168.157.39 bash << 'EOF'
set -e

# Run operator setup
bash /hexos/platform/bin/hexos-setup.sh operator

# Verify mode
echo ""
echo "Deployment profile:"
bash /hexos/platform/bin/hexos-mode.sh

# Verify version in config
VERSION=$(grep 'version:' /hexos/platform/config/hexos.yaml 2>/dev/null | head -1 | grep -o '"[^"]*"' | tr -d '"')
echo ""
echo "Platform version: $VERSION"
echo "✅ Operator mode active"
EOF
```

**What operator mode gives Markus:**
- Phase 0 upstream patches (active via the HexOS npm package itself)
- Scanner available as opt-in tool (`hexos-platform security scan`)
- No workspace jails, egress control, or forced audit trail (those are managed-mode only)
- Full access, no restrictions, maximum speed

### Step 11: Final Verification (1 min)

```bash
ssh root@204.168.157.39 bash << 'EOF'
echo "═══════════════════════════════════════════"
echo "  FINAL STATE — MARKUS SERVER"
echo "═══════════════════════════════════════════"
echo ""
echo "HexOS package: $(hexos --version 2>/dev/null)"
echo "Platform mode: $(grep 'mode:' /hexos/platform/config/hexos.yaml 2>/dev/null | head -1)"
echo "Platform ver:  $(grep 'version:' /hexos/platform/config/hexos.yaml 2>/dev/null | head -1)"
echo ""
echo "Gateways:"
echo "  Eevee: $(systemctl --user is-active hexos-gateway) (port 18789)"
echo "  Mew:   $(systemctl --user is-active hexos-gateway-mew) (port 18795)"
echo ""
echo "Health:"
echo "  Eevee: HTTP $(curl -s -o /dev/null -w '%{http_code}' http://localhost:18789/healthz)"
echo "  Mew:   HTTP $(curl -s -o /dev/null -w '%{http_code}' http://localhost:18795/healthz)"
echo ""
echo "Ollama: $(systemctl is-active ollama)"
echo ""
echo "Platform scripts: $(ls /hexos/platform/bin/*.sh 2>/dev/null | wc -l) scripts deployed"
echo ""
echo "═══════════════════════════════════════════"
echo "  ✅ MIGRATION COMPLETE"
echo "  □ Test Eevee via Telegram"
echo "  □ Test Mew via Telegram (as Markus)"
echo "  □ Monitor for 48h before cleanup"
echo "═══════════════════════════════════════════"
EOF
```

---

## Cleanup (AFTER 48h Stable)

```bash
ssh root@204.168.157.39 bash << 'EOF'
# Remove old service files
rm ~/.config/systemd/user/clawdbot-gateway.service
rm ~/.config/systemd/user/clawdbot-gateway-mew.service
systemctl --user daemon-reload

# Uninstall clawdbot
npm uninstall -g clawdbot

echo "Old configs preserved at:"
echo "  /root/.clawdbot/ (Eevee original)"
echo "  /root/.clawdbot-mew/ (Mew original)"
echo "  /root/.clawdbot.bak.* (timestamped backup)"
echo ""
echo "Delete these manually after 30 days if stable."
EOF
```

---

## Risk Matrix

| # | Risk | Likelihood | Impact | Mitigation | Verified? |
|---|------|-----------|--------|------------|-----------|
| 1 | HexOS doesn't read `hexos.json` same as `clawdbot.json` | Very Low | High | Same JSON schema — verified on Steve's server. Only filename differs. | ✅ Verified |
| 2 | `HEXOS_*` env vars not recognized | None | N/A | Confirmed in source: ALL env vars are `HEXOS_*`. Zero `CLAWDBOT_*` references in codebase. | ✅ Source verified |
| 3 | `HEXOS_ALLOW_MULTI_GATEWAY` not supported | Low | High (Mew won't start) | Source has `HEXOS_ALLOW_MULTI_GATEWAY` — start Eevee first, then Mew. If Mew fails, check logs. | ⚠️ Need to test |
| 4 | Session transcripts lost | None | High | We COPY, never move. Originals preserved in `.clawdbot*` dirs. | ✅ By design |
| 5 | Telegram bot disconnects permanently | Very Low | Medium | Bot tokens are in config. Telegram auto-reconnects on gateway start. | ✅ Known behavior |
| 6 | Ollama breaks | None | Medium | Separate service, unchanged. Config points to `localhost:11434`. | ✅ Independent |
| 7 | Cron jobs lost | None | Medium | Copied to new state dir. `jobs.json` preserved. | ✅ By design |
| 8 | API keys/tokens not migrated | None | Critical | Config is byte-for-byte copy. All keys (Anthropic OAuth, NIM, Moonshot, Brave, Telegram) preserved. | ✅ By design |
| 9 | Workspace files corrupted | None | Critical | Workspaces (`/root/clawd/`, `/root/therapist/`) are NOT touched. Only state dirs change. | ✅ By design |

---

## Timeline

| Step | Duration | Downtime? |
|------|----------|-----------|
| Pre-flight + backups | 2 min | No |
| Stop gateways | 10 sec | ⏱️ START |
| Install HexOS | 30 sec | ⏱️ |
| Migrate Eevee config | 30 sec | ⏱️ |
| Migrate Mew config | 30 sec | ⏱️ |
| Create systemd services | 30 sec | ⏱️ |
| Swap services | 15 sec | ⏱️ |
| Start + verify Eevee | 1 min | ⏱️ (Eevee back) |
| Start + verify Mew | 1 min | ⏱️ END |
| Full verification | 3 min | No |
| Deploy operator mode | 2 min | No |
| Final verification | 1 min | No |
| **Total** | **~13 min** | **~5 min downtime** |

---

*This PRD is specific to Markus's server. Do not apply to other servers without creating a separate runbook.*
