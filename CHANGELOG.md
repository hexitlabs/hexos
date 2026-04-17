# HexOS Changelog

All notable changes to HexOS are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/).

## [2026.1.24-24] - 2026-04-17

### Fixes
- **`hexos models set openai-codex/gpt-5.4` now auto-registers the Codex provider**
  - `models set` now injects the missing `models.providers.openai-codex` block when selecting an OpenAI Codex model.
  - The injected provider uses the correct API mode: `openai-codex-responses`.
  - This prevents existing installs from landing in a broken state where GPT-5.4 becomes the default model but agent runs still fail with `Unknown model: openai-codex/gpt-5.4`.

## [2026.1.24-23] - 2026-04-16

### Fixes
- **OpenAI Codex GPT-5.4 config/runtime fix**
  - Added `openai-codex-responses` to the config schema so `models.providers.openai-codex.api` validates correctly.
  - Preserved provider-level `api` metadata when inlining models from config so `openai-codex/gpt-5.4` no longer crashes at runtime with `Unhandled API in mapOptionsForApi: undefined`.
  - Verified end-to-end with a live Hiro gateway smoke test using Codex/ChatGPT OAuth; `openai-codex/gpt-5.4` responded successfully.

## [2026.1.24-22] - 2026-04-15

### Features
- **GPT-5.4 Support** — Added full support for OpenAI's GPT-5.4 model
  - Updated all model references from GPT-5.2 to GPT-5.4
  - Added GPT-5.4 to model catalogs, cost tables, and context window configs
  - Updated OpenAI Codex OAuth flow to default to GPT-5.4
  - Updated XHIGH thinking level models to include GPT-5.4
  - Updated model picker placeholders and error messages

## [v0.6.0] - 2026-03-25

### Features
- **Audit Trail** — tamper-evident JSONL logging with SHA-256 hash chaining
- Credential sanitizer — 30+ regex patterns strip secrets before logging (<3ms, zero false positives)
- Approval system — risky actions require explicit approval before execution
- Anomaly detection alerts — API call spikes, new endpoints, repeated failures, approval timeouts
- Viewer CLI — `hexos audit log/search/stats/verify`
- Export system — JSON/CSV with date range and type filters, gzip compression
- Retention policy — 90-day default with archival and cleanup
- Hash chain verification — `hexos audit verify` detects tampering instantly

### Bug Fixes
- Fixed `grep -c || echo 0` producing multiline values in arithmetic expressions (egress-status, viewer)
- Fixed `hexos mode` grep matching multiple `mode:` YAML entries
- Fixed yq v4 compatibility in preset loading (index-based iteration)

## [v0.5.0] - 2026-03-24

### Features
- **Deployment Profiles** — Operator (unrestricted, internal) vs Managed (full security, clients)
- `hexos setup [operator|managed]` — configure deployment profile
- `hexos mode` — display current profile with security stack status
- `hexos deploy <client> [--presets p1,p2]` — one-command client onboarding (managed mode)
- Template configs for operator and managed modes

## [v0.4.0] - 2026-03-24

### Features
- **Network Egress Control** — default-deny outbound firewall per client via nftables
- 10 preset egress policies: Anthropic, OpenAI, Telegram, GitHub, Stripe, SALESmanago, Brave Search, Firecrawl, Google Search, web-general
- YAML allowlists with wildcard subdomain support (`*.example.com`)
- DNS control — force platform resolver, block DNS exfiltration
- Emergency lockdown/unlock (`hexos egress lockdown/unlock`)
- Hot-reload without dropping connections (`hexos egress reload`)
- Violation logging with rate-limited syslog + alert integration
- Hostname resolution caching with 5-minute refresh
- Endpoint connectivity testing (`hexos egress test`)
- Full CLI: `hexos egress apply/remove/status/test/reload/presets`

### Security
- IPv6 bypass prevention — `meta nfproto ipv6 counter drop` blocks `curl -6` bypass
- Atomic DNS set updates — single nft transaction prevents race condition during refresh
- Hostname validation — strict alphanumeric + dots + hyphens only (prevents injection)
- DNS resolver validation — must be valid IPv4 before nftables insertion

## [v0.3.0] - 2026-03-24

### Features
- **Pre-Runtime Security Scanner** — scans skills, commands, and workspaces before execution
- Scanner abstraction layer with pluggable backends (builtin + DefenseClaw stub)
- 7 threat pattern categories: dangerous commands, secrets, obfuscation, exfiltration, malware, privilege escalation, path traversal (60+ patterns)
- Skill install gate — scans skill directories before installation, blocks malicious skills
- Exec pre-check — scans commands before execution (14ms fast path, 100ms deep scan)
- Workspace audit — drift detection with baseline comparison, threat classification (293ms for 50 files)
- Policy engine — YAML-based per-client scan policies, strict/permissive modes
- Alert foundation — log-based alerting with deduplication (Telegram integration in Phase 6)
- `hexos security scan/policy/report` CLI commands
- Full test suite: 60/60 tests pass

### Bug Fixes
- Fixed bash subshell scoping in scanner pipeline (FINDINGS array invisible in parent shell)
- Fixed alert.sh argument order (severity, client, type, msg)

## [v0.2.0] - 2026-03-24

### Features
- **Workspace Jail** — Multi-tenant filesystem isolation for client deployments
- Per-client system users (`hexos-<client>`) with no login shell
- Isolated workspaces at `/hexos/<client>/` with full directory structure
- `hexos client create <name>` — automated client onboarding
- `hexos client remove <name>` — graceful teardown with optional archive
- `hexos security verify <name>` — 34+ automated security penetration tests
- `hexos client stats <name>` — per-client resource monitoring
- Cross-client isolation via systemd InaccessiblePaths (auto-refreshed)
- CLI dispatcher (`scripts/hexos`)

### Security
- Systemd hardening template: ProtectHome, ProtectSystem=strict, PID namespace isolation
- Capability dropping (CapabilityBoundingSet=), NoNewPrivileges
- System call filtering (@system-service whitelist, dangerous calls blocked)
- Resource limits per client (MemoryMax=1G, CPUQuota=100%, TasksMax=256)
- Cleanup on partial failure (trap handler rolls back orphaned state)
- Input validation on all management scripts (path traversal protection)
- `/hexos/shared/` set to root:root read-only (no cross-client skill injection)

## [v0.1.1] - 2026-03-24

### Security
- Exec approval bypass fix — `time` wrapper unwrapping (12 wrapper commands, 4-level recursion)
- Exec env var hardening — expanded blocklist from 6 to 30 dangerous env vars
- Credential stripping from diagnostic cache-trace output

### Notes
- Memory regression patch (upstream 2026.3.13) determined N/A — HexOS uses tsc compilation, not Rollup/Vite bundling

## [v0.1.0] - 2026-01-24

### Initial Release
- Forked from Clawdbot 2026.1.24-3
- Rebranded to HexOS (@hexitlabs/hexos)
- NVIDIA NIM as default model provider
- Lightpanda skill integration
- /effort command
- Recall + Vigil bundled plugins
- Setup wizard
- 42 HexOS-specific commits
