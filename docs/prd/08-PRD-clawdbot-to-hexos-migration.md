# PRD 08 — Clawdbot → HexOS Migration Runbook

*Version: 1.0 · March 25, 2026*
*Status: Approved*
*Target: Markus's server (EEVEELUTIONS) — 204.168.157.39*

---

## Overview

Migrate Markus's server from vanilla Clawdbot (`2026.1.24-3`) to HexOS (`@hexitlabs/hexos@2026.1.24-18`). Two gateways run on this server: **Eevee** (main agent) and **Mew** (therapist companion). Both must continue working identically after migration — same LLM configs, fallbacks, memory, sessions, cron jobs, Telegram connections, and workspace files.

**Principle:** Zero data loss, zero downtime beyond gateway restart (~30 seconds each), identical behavior post-migration.

---

## Current State (Pre-Migration Audit)

### Server
| Property | Value |
|----------|-------|
| Hostname | EEVEELUTIONS |
| IP | 204.168.157.39 (IPv4), 2a01:4f9:c014:811::1 (IPv6) |
| OS | Linux (Hetzner) |
| Node.js | v22.22.1 |
| Package | `clawdbot@2026.1.24-3` |
| Binary | `/usr/bin/clawdbot` → `/usr/lib/node_modules/clawdbot/dist/entry.js` |
| Ollama | Active, `nomic-embed-text` model loaded |

### Gateway 1: Eevee (Main Agent)

| Property | Value |
|----------|-------|
| Config | `/root/.clawdbot/clawdbot.json` |
| State dir | `/root/.clawdbot/` |
| Workspace | `/root/clawd/` |
| Port | 18789 |
| Systemd | `clawdbot-gateway.service` (user service) |
| Telegram bot | Token: `8724516087:AAG...` |
| Telegram policy | `dmPolicy: pairing` |
| Session transcripts | 2 JSONL files in `/root/.clawdbot/agents/` |
| Cron jobs | `/root/.clawdbot/cron/jobs.json` |
| Sub-agents | `radar` |
| Total size | ~12MB |

**LLM Configuration (MUST be preserved exactly):**

| Setting | Value |
|---------|-------|
| Primary model | `anthropic/claude-opus-4-6` |
| Fallback 1 | `nvidia/nvidia/nemotron-3-super-120b-a12b` |
| Fallback 2 | `anthropic/claude-sonnet-4-6` |
| Fallback 3 | `moonshot/kimi-k2.5` |
| Fallback 4 | `moonshot/kimi-k2-0905-preview` |
| Heartbeat model | `anthropic/claude-sonnet-4-6` |
| Subagent model | `anthropic/claude-sonnet-4-6` |

**Providers (3 configured):**
- **Anthropic** — `api.anthropic.com`, OAuth token auth, Opus + Sonnet models
- **NVIDIA NIM** — `integrate.api.nvidia.com/v1`, API key auth, Nemotron 3 Super 120B
- **Moonshot** — `api.moonshot.ai/v1`, API key auth, Kimi K2 + K2.5

**Memory:**
- Provider: Ollama (local) at `http://localhost:11434/v1/`
- Model: `nomic-embed-text`
- Sources: memory + sessions
- Session memory: enabled

**Other settings:**
- Context tokens: 1,000,000
- Compaction: safeguard mode, memoryFlush enabled
- Heartbeat: every 1h
- Max concurrent: 4
- Session reset: idle after 480 minutes
- Exec security: full
- Gateway bind: loopback
- Gateway auth: token `c5557fa9829dc2624ff5f7cbfc9697c7300ddc9a6c5e8f96`
- Brave API key: in systemd env var

### Gateway 2: Mew (Therapist Companion)

| Property | Value |
|----------|-------|
| Config | `/root/.clawdbot-mew/clawdbot.json` |
| State dir | `/root/.clawdbot-mew/` |
| Workspace | `/root/therapist/` |
| Port | 18795 |
| Systemd | `clawdbot-gateway-mew.service` (user service) |
| Telegram bot | Token: `8775097819:AAG...` |
| Telegram policy | `dmPolicy: allowlist`, allowFrom: `["6013499331"]` (Markus only) |
| Session transcripts | 3 JSONL files |
| Cron jobs | `/root/.clawdbot-mew/cron/jobs.json` |
| Total size | ~4.9MB |

**LLM Configuration (MUST be preserved exactly):**

| Setting | Value |
|---------|-------|
| Primary model | `anthropic/claude-opus-4-6` |
| Fallback 1 | `moonshot/kimi-k2.5` |
| Thinking | `high` (default) |

**Providers (2 configured):**
- **Anthropic** — Opus 4.6 only (cost: input 15, output 75 — full pricing)
- **Moonshot** — Kimi K2.5

**Other settings:**
- Context tokens: 1,000,000
- Compaction: safeguard mode
- Heartbeat: every 1h
- Max concurrent: 1
- Session reset: daily at 21:00
- Group policy: disabled
- CLAWDBOT_ALLOW_MULTI_GATEWAY=1 (env var)

### Workspace Files (MUST NOT be touched)

```
/root/clawd/
├── SOUL.md
├── MEMORY.md
├── HEARTBEAT.md
└── (other agent files)

/root/therapist/
├── SOUL.md
├── HEARTBEAT.md
└── (other therapist files)

/root/clawd-radar/
└── (radar sub-agent workspace)
```

### Systemd Service Files

**Eevee** (`~/.config/systemd/user/clawdbot-gateway.service`):
```ini
[Unit]
Description=Clawdbot Gateway (v2026.1.24-3)
After=network-online.target
Wants=network-online.target

[Service]
ExecStart="/usr/bin/node" "/usr/lib/node_modules/clawdbot/dist/entry.js" gateway --port 18789
Restart=always
RestartSec=5
KillMode=process
Environment=HOME=/root
Environment="PATH=/root/.local/bin:/root/.npm-global/bin:/root/bin:/root/.nvm/current/bin:/root/.fnm/current/bin:/root/.volta/bin:/root/.asdf/shims:/root/.local/share/pnpm:/root/.bun/bin:/usr/local/bin:/usr/bin:/bin"
Environment=CLAWDBOT_GATEWAY_PORT=18789
Environment=CLAWDBOT_GATEWAY_TOKEN=c5557fa9829dc2624ff5f7cbfc9697c7300ddc9a6c5e8f96
Environment="CLAWDBOT_SYSTEMD_UNIT=clawdbot-gateway.service"
Environment=CLAWDBOT_SERVICE_MARKER=clawdbot
Environment=CLAWDBOT_SERVICE_KIND=gateway
Environment=CLAWDBOT_SERVICE_VERSION=2026.1.24-3
Environment=BRAVE_API_KEY=BSAOdyOFxUvCpj2l_yZ9Jhv2UaOa3KQ

[Install]
WantedBy=default.target
```

**Mew** (`~/.config/systemd/user/clawdbot-gateway-mew.service`):
```ini
[Unit]
Description=Clawdbot Gateway — Mew (Therapist Companion)
After=network-online.target clawdbot-gateway.service
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/node /usr/lib/node_modules/clawdbot/dist/entry.js gateway --port 18795
Environment=CLAWDBOT_PROFILE=mew
Environment=CLAWDBOT_CONFIG_PATH=/root/.clawdbot-mew/clawdbot.json
Environment=CLAWDBOT_STATE_DIR=/root/.clawdbot-mew
Environment=CLAWDBOT_GATEWAY_PORT=18795
Environment=CLAWDBOT_SERVICE_MARKER=clawdbot-mew
Environment=CLAWDBOT_SYSTEMD_UNIT=clawdbot-gateway-mew.service
Environment=CLAWDBOT_ALLOW_MULTI_GATEWAY=1
WorkingDirectory=/root/therapist
Restart=on-failure
RestartSec=30

[Install]
WantedBy=default.target
```

---

## Migration Plan

### Pre-Flight Checks

```bash
# 1. Verify SSH access
ssh root@204.168.157.39 "hostname"
# Expected: EEVEELUTIONS

# 2. Verify both gateways running
ssh root@204.168.157.39 "systemctl --user status clawdbot-gateway clawdbot-gateway-mew --no-pager"
# Expected: both active (running)

# 3. Verify Ollama running
ssh root@204.168.157.39 "curl -s http://localhost:11434/api/tags | jq '.models[].name'"
# Expected: nomic-embed-text:latest

# 4. Verify current package
ssh root@204.168.157.39 "clawdbot --version"
# Expected: 2026.1.24-3

# 5. Backup configs (CRITICAL)
ssh root@204.168.157.39 "cp -a /root/.clawdbot /root/.clawdbot.backup.$(date +%Y%m%d)"
ssh root@204.168.157.39 "cp -a /root/.clawdbot-mew /root/.clawdbot-mew.backup.$(date +%Y%m%d)"
ssh root@204.168.157.39 "cp -a ~/.config/systemd/user/clawdbot-gateway.service ~/.config/systemd/user/clawdbot-gateway.service.bak"
ssh root@204.168.157.39 "cp -a ~/.config/systemd/user/clawdbot-gateway-mew.service ~/.config/systemd/user/clawdbot-gateway-mew.service.bak"
```

### Step 1: Stop Both Gateways

```bash
ssh root@204.168.157.39 "systemctl --user stop clawdbot-gateway-mew clawdbot-gateway"

# Verify stopped
ssh root@204.168.157.39 "ps aux | grep -E 'clawdbot|hexos' | grep -v grep"
# Expected: empty
```

**Downtime starts here.** Eevee and Mew are offline. Telegram messages will queue and deliver when gateways restart.

### Step 2: Install HexOS Package

```bash
ssh root@204.168.157.39 "npm install -g @hexitlabs/hexos"

# Verify installation
ssh root@204.168.157.39 "hexos --version"
# Expected: 2026.1.24-18

# Verify binary path
ssh root@204.168.157.39 "which hexos"
# Expected: /usr/bin/hexos

# Verify entry.js exists
ssh root@204.168.157.39 "ls /usr/lib/node_modules/@hexitlabs/hexos/dist/entry.js"
```

**Note:** Do NOT uninstall clawdbot first. Install hexos alongside, verify it works, then clean up old package later.

### Step 3: Migrate Config Files

**Eevee:** Copy clawdbot config to hexos format.

```bash
ssh root@204.168.157.39 bash -s << 'EOF'
# Create HexOS state directory
mkdir -p /root/.hexos

# Copy config (rename clawdbot.json → hexos.json)
cp /root/.clawdbot/clawdbot.json /root/.hexos/hexos.json

# Copy all state data (sessions, agents, cron, identity, devices, telegram)
for dir in agents cron devices identity telegram sessions; do
    if [ -d "/root/.clawdbot/$dir" ]; then
        cp -a "/root/.clawdbot/$dir" "/root/.hexos/$dir"
    fi
done

# Copy any other state files
for f in /root/.clawdbot/*.json /root/.clawdbot/*.bak; do
    [ -f "$f" ] && cp -a "$f" /root/.hexos/
done

# Update meta in hexos.json
sed -i 's/"lastTouchedVersion": "2026.1.24-3"/"lastTouchedVersion": "2026.1.24-18"/g' /root/.hexos/hexos.json

echo "Eevee config migrated to /root/.hexos/"
ls -la /root/.hexos/
EOF
```

**Mew:** Copy clawdbot-mew config to hexos-mew format.

```bash
ssh root@204.168.157.39 bash -s << 'EOF'
# Create HexOS Mew state directory
mkdir -p /root/.hexos-mew

# Copy config (rename clawdbot.json → hexos.json)
cp /root/.clawdbot-mew/clawdbot.json /root/.hexos-mew/hexos.json

# Copy all state data
for dir in agents cron devices identity telegram sessions; do
    if [ -d "/root/.clawdbot-mew/$dir" ]; then
        cp -a "/root/.clawdbot-mew/$dir" "/root/.hexos-mew/$dir"
    fi
done

# Copy any other state files
for f in /root/.clawdbot-mew/*.json /root/.clawdbot-mew/*.bak; do
    [ -f "$f" ] && cp -a "$f" /root/.hexos-mew/
done

# Update meta in hexos.json
sed -i 's/"lastTouchedVersion": "2026.1.24-3"/"lastTouchedVersion": "2026.1.24-18"/g' /root/.hexos-mew/hexos.json

echo "Mew config migrated to /root/.hexos-mew/"
ls -la /root/.hexos-mew/
EOF
```

### Step 4: Create New Systemd Services

**Eevee** (`~/.config/systemd/user/hexos-gateway.service`):

```bash
ssh root@204.168.157.39 bash -s << 'SERVICEEOF'
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
echo "Created hexos-gateway.service"
SERVICEEOF
```

**Mew** (`~/.config/systemd/user/hexos-gateway-mew.service`):

```bash
ssh root@204.168.157.39 bash -s << 'SERVICEEOF'
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
echo "Created hexos-gateway-mew.service"
SERVICEEOF
```

### Step 5: Disable Old Services, Enable New

```bash
ssh root@204.168.157.39 bash -s << 'EOF'
# Reload systemd
systemctl --user daemon-reload

# Disable old services (don't delete yet — keep for rollback)
systemctl --user disable clawdbot-gateway.service
systemctl --user disable clawdbot-gateway-mew.service

# Enable new services
systemctl --user enable hexos-gateway.service
systemctl --user enable hexos-gateway-mew.service

echo "Old services disabled, new services enabled"
EOF
```

### Step 6: Start Eevee (Gateway 1)

```bash
ssh root@204.168.157.39 "systemctl --user start hexos-gateway"

# Wait 5 seconds for startup
sleep 5

# Verify running
ssh root@204.168.157.39 "systemctl --user status hexos-gateway --no-pager | head -5"
# Expected: active (running)

# Verify process name
ssh root@204.168.157.39 "ps aux | grep hexos | grep -v grep"
# Expected: hexos and hexos-gateway processes

# Verify gateway responding
ssh root@204.168.157.39 "curl -s -o /dev/null -w '%{http_code}' http://localhost:18789/healthz"
# Expected: 200

# Verify Telegram connected (check logs)
ssh root@204.168.157.39 "journalctl --user -u hexos-gateway --no-pager -n 20 | grep -i telegram"
# Expected: "Telegram: connected" or similar
```

### Step 7: Start Mew (Gateway 2)

```bash
ssh root@204.168.157.39 "systemctl --user start hexos-gateway-mew"

# Wait 5 seconds
sleep 5

# Verify running
ssh root@204.168.157.39 "systemctl --user status hexos-gateway-mew --no-pager | head -5"
# Expected: active (running)

# Verify gateway responding
ssh root@204.168.157.39 "curl -s -o /dev/null -w '%{http_code}' http://localhost:18795/healthz"
# Expected: 200

# Verify Telegram connected
ssh root@204.168.157.39 "journalctl --user -u hexos-gateway-mew --no-pager -n 20 | grep -i telegram"
```

**Downtime ends here.** Both gateways should be live.

### Step 8: Post-Migration Verification

```bash
# 1. Both processes running as hexos (not clawdbot)
ssh root@204.168.157.39 "ps aux | grep -E 'hexos|clawdbot' | grep -v grep"
# Expected: ONLY hexos processes, zero clawdbot processes

# 2. Both systemd services healthy
ssh root@204.168.157.39 "systemctl --user is-active hexos-gateway hexos-gateway-mew"
# Expected: active / active

# 3. Eevee config preserved — check model and fallbacks
ssh root@204.168.157.39 "cat /root/.hexos/hexos.json | grep -A6 '\"primary\"'"
# Expected: anthropic/claude-opus-4-6 with 4 fallbacks

# 4. Mew config preserved — check model and fallbacks
ssh root@204.168.157.39 "cat /root/.hexos-mew/hexos.json | grep -A3 '\"primary\"'"
# Expected: anthropic/claude-opus-4-6 with kimi-k2.5 fallback

# 5. Memory search working (Ollama)
ssh root@204.168.157.39 "curl -s http://localhost:11434/api/tags | grep nomic"
# Expected: nomic-embed-text

# 6. Cron jobs migrated
ssh root@204.168.157.39 "cat /root/.hexos/cron/jobs.json | head -5"
ssh root@204.168.157.39 "cat /root/.hexos-mew/cron/jobs.json | head -5"

# 7. HexOS version correct
ssh root@204.168.157.39 "hexos --version"
# Expected: 2026.1.24-18

# 8. Workspace files untouched
ssh root@204.168.157.39 "ls /root/clawd/SOUL.md /root/therapist/SOUL.md"
# Expected: both exist

# 9. Send a test message via Telegram to both bots
# → Message Eevee's Telegram bot, verify response
# → Message Mew's Telegram bot, verify response
```

### Step 9: Cleanup (AFTER 24h stable)

Only run this after confirming everything works for at least 24 hours:

```bash
ssh root@204.168.157.39 bash -s << 'EOF'
# Remove old systemd service files
rm ~/.config/systemd/user/clawdbot-gateway.service
rm ~/.config/systemd/user/clawdbot-gateway-mew.service
systemctl --user daemon-reload

# Uninstall old clawdbot package
npm uninstall -g clawdbot

# Keep backup configs for 30 days, then delete
echo "Backups at /root/.clawdbot.backup.* and /root/.clawdbot-mew.backup.*"
echo "Old configs at /root/.clawdbot/ and /root/.clawdbot-mew/"
echo "Delete after 30 days if everything is stable"
EOF
```

---

## Rollback Plan

If anything goes wrong at any step:

```bash
# 1. Stop new services
ssh root@204.168.157.39 "systemctl --user stop hexos-gateway hexos-gateway-mew 2>/dev/null"

# 2. Re-enable old services
ssh root@204.168.157.39 "systemctl --user enable clawdbot-gateway.service clawdbot-gateway-mew.service"

# 3. Start old services
ssh root@204.168.157.39 "systemctl --user start clawdbot-gateway clawdbot-gateway-mew"

# 4. Verify old gateways running
ssh root@204.168.157.39 "systemctl --user status clawdbot-gateway clawdbot-gateway-mew --no-pager | head -10"
```

Old configs are untouched (we copied, not moved). Old package is still installed. Rollback takes 30 seconds.

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| HexOS doesn't read `hexos.json` the same as `clawdbot.json` | Low | High | Configs are identical format — only filename changes. Verified on Steve's server. |
| Env vars `HEXOS_*` not recognized (backward compat) | Medium | High | HexOS may still read `CLAWDBOT_*` — test on first gateway start. If not, the config file has all the same values. Fallback: keep CLAWDBOT_ vars alongside HEXOS_ vars. |
| Session transcripts lost | None | High | We copy (not move) all state. Originals stay in `.clawdbot*` dirs. |
| Telegram bot doesn't reconnect | Low | Medium | Bot tokens are in config. Restart service. Telegram auto-reconnects. |
| Ollama memory search breaks | None | Medium | Ollama is a separate service. Config points to `localhost:11434`. Unchanged. |
| Cron jobs lost | None | Medium | Copied to new state dir. Verified. |
| Multi-gateway env var not recognized | Medium | High | `CLAWDBOT_ALLOW_MULTI_GATEWAY=1` → `HEXOS_ALLOW_MULTI_GATEWAY=1`. If not recognized, both gateways might not start. Test Eevee first, then Mew. |

---

## LLM Config Verification Checklist

After migration, verify EVERY model config matches:

### Eevee
- [ ] Primary: `anthropic/claude-opus-4-6`
- [ ] Fallback 1: `nvidia/nvidia/nemotron-3-super-120b-a12b`
- [ ] Fallback 2: `anthropic/claude-sonnet-4-6`
- [ ] Fallback 3: `moonshot/kimi-k2.5`
- [ ] Fallback 4: `moonshot/kimi-k2-0905-preview`
- [ ] Anthropic API key present
- [ ] NVIDIA NIM API key present
- [ ] Moonshot API key present
- [ ] Heartbeat model: `anthropic/claude-sonnet-4-6`
- [ ] Subagent model: `anthropic/claude-sonnet-4-6`
- [ ] Memory search: Ollama nomic-embed-text at localhost:11434

### Mew
- [ ] Primary: `anthropic/claude-opus-4-6`
- [ ] Fallback 1: `moonshot/kimi-k2.5`
- [ ] Anthropic API key present (OAuth token)
- [ ] Moonshot API key present
- [ ] Thinking: `high` (default)
- [ ] Telegram allowlist: `6013499331` (Markus only)
- [ ] Memory search: Ollama nomic-embed-text at localhost:11434

---

## Timeline

| Step | Duration | Cumulative |
|------|----------|------------|
| Pre-flight checks + backups | 2 min | 2 min |
| Stop gateways | 10 sec | ~2 min |
| Install HexOS | 30 sec | ~3 min |
| Migrate configs (Eevee + Mew) | 1 min | ~4 min |
| Create systemd services | 1 min | ~5 min |
| Swap services (disable/enable) | 30 sec | ~5.5 min |
| Start + verify Eevee | 1 min | ~6.5 min |
| Start + verify Mew | 1 min | ~7.5 min |
| Post-migration verification | 3 min | ~10 min |
| **Total** | | **~10 minutes** |
| **Downtime** | | **~7 minutes** (between stop and Mew verified) |

---

*This runbook applies to any Clawdbot → HexOS migration. Adapt server IPs, gateway names, and config paths for other servers (e.g., Steve's server is already migrated and can be used as reference).*
