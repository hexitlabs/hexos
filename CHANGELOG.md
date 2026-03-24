# HexOS Changelog

All notable changes to HexOS are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/).

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
