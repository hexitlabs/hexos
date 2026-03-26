# HexOS Roadmap

*Updated: March 26, 2026*

## Completed

| Version | Phase | What | Status |
|---------|-------|------|--------|
| v0.1.1 | Phase 0: Upstream Patches | Exec bypass fix, env hardening, credential stripping | ✅ Shipped |
| v0.2.0 | Phase 1: Workspace Jail | Per-client Linux user isolation, systemd hardening, 36/36 tests | ✅ Shipped |
| v0.3.0 | Phase 1.5: Pre-Runtime Scanner | Threat scanning before execution, pluggable backends, 60/60 tests | ✅ Shipped |
| v0.4.0 | Phase 2: Network Egress Control | nftables per-client allowlisting, DNS control, presets | ✅ Shipped |
| v0.5.0 | Deployment Profiles | Operator vs Managed modes, one-command client deploy | ✅ Shipped |
| v0.6.0 | Phase 6: Audit Trail | Tamper-evident logging, credential sanitizer, approval system, 84 tests | ✅ Shipped |
| — | Multi-Tenant Architecture | Zero-trust 3-layer design (control plane + audit server + client servers) | ✅ Spec'd |
| — | Staging Validation | Full v0.6.0 integration test on staging (Operator + Managed modes) | ✅ Passed |

## In Progress

| Target | What | PRD | Status |
|--------|------|-----|--------|
| v0.7.0 | **HexOS Vault** — AES-256-GCM encrypted credential storage, leak detection, config resolution, audit trail | `docs/vault.md` | ✅ Shipped (PR #12, Mar 26) |
| Mar 31, 2026 | **Jirka Migration** — First managed client deployment | — | 🔧 Runbook written |
| Q2 2026 | **v0.8.0: Deployment Profiles v2** — 3-tier capability system (Sovereign/Operator/Managed), 21 gated capabilities, override system, approval gates, cost limits, agent inheritance, observability | `tasks/prd-hexos-deployment-profiles-v2.md` | 📋 PRD written |
| Q2 2026 | **v0.9.0: Multi-Tenant Docker Runtime** — Docker containerized agents, provisioning API, operator↔agent internal API, Docker-native isolation, per-customer cost tracking, fleet capabilities | `tasks/prd-hexos-multi-tenant-docker.md` | 📋 PRD written |
| Q2 2026 | **Multi-Tenant Infra** — Audit server, provisioning automation, fleet management | `docs/architecture/multi-tenant.md` | 📋 Spec approved |

## Planned

| Target | What | PRD | Priority |
|--------|------|-----|----------|
| Q3 2026 | **v0.10.0: Injection Shield + Tool Guardrails + Custom Profiles** — Runtime injection scanning, per-tool resource limits, fully custom capability profiles | `tasks/prd-hexos-security-hardening.md` | Medium |
| Q2 2026 | **Phase 7: A2A Protocol Integration** — Agent-to-agent interoperability via Google's A2A standard. Inbound + outbound, auth gate, isolated sessions, full security pipeline. | `docs/prd/07-PRD-a2a-integration.md` | Medium |
| Q2 2026 | **Phase 5: Inference Policy** — Token budget management, model routing, cost optimization per client. Optional, off by default. | — | Low |
| Q2 2026 | **Client Dashboard** — Read-only web view of audit logs and agent activity for clients | — | Low |

## Deferred

| What | Trigger to Revisit | Notes |
|------|-------------------|-------|
| Phase 3: Docker Sandbox | Skills marketplace, 5+ clients, or SOC 2 request | Adds kernel namespace isolation on top of user-level jails |
| Phase 4: Blueprints | 3+ clients needing repeatability | Template-based client configurations |
| MCP Integration | Client demand | Anthropic's Model Context Protocol for tool interop |
| Multi-Region | Client in non-EU region | Hetzner Ashburn (US), Singapore (APAC) |

## Architecture Docs

- **Security Stack:** 6 phases, 9,100+ lines, 144 tests — see `platform/`
- **Multi-Tenant:** Zero-trust, per-client servers — see `docs/architecture/multi-tenant.md`
- **A2A Integration:** Agent interoperability — see `docs/prd/07-PRD-a2a-integration.md`
