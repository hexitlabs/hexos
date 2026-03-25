# HexOS Multi-Tenant Architecture

*Version: 1.0 — March 25, 2026*
*Status: Approved*

---

## Overview

HexOS operates as a **managed AI agent platform** where HexIT Labs (operator) provisions, secures, and monitors AI agent instances for clients. Each client gets a fully isolated environment with no shared resources, no shared kernel, and no direct network path to operator infrastructure.

**Design Principles:**
1. **Zero trust** — Every component assumes all others may be compromised
2. **Blast radius = one client** — A breach on one server cannot reach any other
3. **Append-only audit** — Audit data flows one direction through a dedicated buffer
4. **Pull-based management** — Client servers pull updates; operator never pushes
5. **No secrets on shared surfaces** — Operator keys never touch client servers, client keys never touch operator servers

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         OPERATOR ZONE                               │
│                                                                     │
│  ┌──────────────────────┐         ┌──────────────────────┐         │
│  │   Control Plane       │         │   Audit Server       │         │
│  │   (Existing Server)   │  ←read─ │   (Dedicated CX22)   │         │
│  │                       │         │                       │         │
│  │  • Berra + agents     │         │  • Ingest API (HTTPS) │         │
│  │  • Fleet dashboard    │         │  • JSONL storage      │         │
│  │  • Alert processing   │         │  • Hash chain verify  │         │
│  │  • Billing/reporting  │         │  • Update distributor │         │
│  │  • Operator secrets   │         │  • No client secrets  │         │
│  └──────────────────────┘         └──────────┬───────────┘         │
│                                               │                     │
└───────────────────────────────────────────────┼─────────────────────┘
                                                │
                              HTTPS only (append-only push / pull updates)
                                                │
                    ┌───────────────────────────┼───────────────────────────┐
                    │                           │                           │
          ┌─────────┴──────────┐     ┌─────────┴──────────┐     ┌─────────┴──────────┐
          │  Client 1 Server   │     │  Client 2 Server   │     │  Client N Server   │
          │  (Dedicated CX22)  │     │  (Dedicated CX22)  │     │  (Dedicated CX22)  │
          │                    │     │                    │     │                    │
          │  • HexOS platform  │     │  • HexOS platform  │     │  • HexOS platform  │
          │  • Clawdbot gateway│     │  • Clawdbot gateway│     │  • Clawdbot gateway│
          │  • Workspace jail  │     │  • Workspace jail  │     │  • Workspace jail  │
          │  • Egress control  │     │  • Egress control  │     │  • Egress control  │
          │  • Security scanner│     │  • Security scanner│     │  • Security scanner│
          │  • Local audit log │     │  • Local audit log │     │  • Local audit log │
          │  • Audit shipper   │     │  • Audit shipper   │     │  • Audit shipper   │
          └────────────────────┘     └────────────────────┘     └────────────────────┘
```

---

## Components

### 1. Control Plane (Operator Server)

**Purpose:** Operator workspace, fleet management, business intelligence.

**Runs:**
- Berra (orchestrator) + all HexIT agents
- Fleet health monitoring (polls audit server, not client servers)
- Alert processing and escalation
- Billing calculation from audit data
- Client onboarding/offboarding orchestration

**Security:**
- Contains all operator secrets (API keys, Telegram tokens, GitHub credentials)
- No inbound connections from client servers (zero attack surface)
- Reads audit data from the audit server only
- Triggers provisioning via Hetzner Cloud API (not direct SSH to client servers)

**Does NOT have:**
- Client API keys or client credentials
- Direct network access to/from client servers
- Any client workload execution

---

### 2. Audit Server (Dedicated Buffer)

**Purpose:** One-way data sink and update distribution point. The only component that communicates with both operator and client zones.

**Hardware:** Hetzner CX22 (2 vCPU, 4GB RAM, 40GB disk) — ~€4/mo

**Runs:**
- **Ingest API** — HTTPS endpoint accepting audit events from client servers
- **JSONL Storage** — Per-client audit logs stored as daily JSONL files (same format as local logs)
- **Hash Chain Verifier** — Validates chain integrity on ingest
- **Update Distributor** — Serves signed HexOS release artifacts for client servers to pull
- **Health Beacon** — Accepts periodic health pings from client servers

**Inbound (from client servers):**
| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/v1/audit/ingest` | POST | Per-client bearer token | Push audit events |
| `/api/v1/health/ping` | POST | Per-client bearer token | Health check heartbeat |
| `/api/v1/updates/check` | GET | Per-client bearer token | Check for HexOS updates |
| `/api/v1/updates/download` | GET | Per-client bearer token | Pull signed update artifact |

**Outbound (to operator — read-only):**
| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/v1/audit/query` | GET | Operator API key | Query audit logs |
| `/api/v1/audit/export` | GET | Operator API key | Export CSV/JSON |
| `/api/v1/fleet/status` | GET | Operator API key | Fleet health overview |
| `/api/v1/audit/verify` | GET | Operator API key | Hash chain verification |

**Security:**
- **No client secrets** — No API keys, no Telegram tokens, no credentials
- **No operator secrets** — No Berra config, no GitHub tokens
- **Append-only from client side** — Clients can POST but never GET/DELETE/UPDATE other clients' data
- **Per-client auth tokens** — Each client server has a unique token; compromising one doesn't expose others
- **Rate limiting** — Prevents abuse (max 1000 events/minute per client)
- **Input validation** — Strict schema enforcement on ingest; rejects malformed data

**Storage Sizing:**
| Metric | Estimate |
|--------|----------|
| Events per client per day | ~500-2,000 |
| Size per event | ~500 bytes |
| Daily storage per client | ~1MB |
| Monthly per client | ~30MB |
| 5 clients × 90 days retention | ~13.5GB |
| CX22 disk (40GB) headroom | ~26GB free |

---

### 3. Client Servers (Per-Client Isolation)

**Purpose:** Run a single client's AI agent in a fully hardened environment.

**Hardware:** Hetzner CX22 (2 vCPU, 4GB RAM, 40GB disk) — ~€4/mo per client

**Runs:**
- Clawdbot gateway (single instance, single client)
- HexOS security stack:
  - Phase 1: Workspace Jail (Linux user isolation, systemd hardening)
  - Phase 1.5: Pre-Runtime Scanner (threat detection before execution)
  - Phase 2: Network Egress Control (nftables allowlisting)
  - Phase 6: Audit Trail (local logging + remote shipping)
- Deployment Profile: `managed` mode (full security stack active)
- Audit Shipper: cron job pushing events to audit server

**Outbound connections (allowlisted):**
| Destination | Port | Purpose |
|-------------|------|---------|
| Anthropic API | 443 | LLM inference |
| Telegram API | 443 | Bot messaging |
| Audit Server | 443 | Audit log shipping + health pings + update checks |
| Client-specific endpoints | As configured | Per-client egress allowlist |

**Inbound connections:**
| Source | Port | Purpose |
|--------|------|---------|
| Telegram webhooks | 443/8443 | Bot webhook delivery |
| **Nothing else** | — | No SSH, no management ports exposed |

**Security:**
- **No operator secrets** — Zero HexIT credentials on this box
- **Single-tenant** — One client per server, no multi-tenant risk
- **Managed mode** — Full HexOS security stack enforced
- **No inbound SSH** — Management via pull-based updates only (see below)
- **Local audit logs** — Kept as backup; primary copy shipped to audit server
- **Auto-updates** — Pulls signed releases from audit server on schedule

**Does NOT have:**
- Access to operator server (no WireGuard, no SSH tunnel, no network path)
- Access to other client servers
- Access to the audit server's query/export endpoints (push-only token)
- Any operator or other-client credentials

---

## Data Flows

### Audit Event Flow

```
1. Client agent performs action (tool call, API call, etc.)
2. HexOS audit logger creates JSONL entry
   → Credential sanitizer strips any secrets (<3ms)
   → Hash chain links to previous entry (tamper-evident)
3. Entry written to local log: /hexos/<client>/audit/YYYY-MM-DD.jsonl
4. Audit shipper (cron, every 60s) batches new entries
5. HTTPS POST → Audit Server ingest API (with per-client bearer token)
6. Audit Server validates schema, verifies hash chain continuity
7. Stored in per-client JSONL on audit server
8. Operator reads via query API for dashboards/alerts/billing
```

### Update Flow (Pull-Based)

```
1. Operator builds new HexOS release, signs the artifact
2. Operator uploads to audit server's update distributor
3. Client servers check /api/v1/updates/check every 15 min
4. If new version available: download signed artifact
5. Verify signature before applying
6. Apply update, restart gateway
7. Report update status via health ping
```

### Provisioning Flow

```
1. Operator runs: hexos provision <client-name>
2. Hetzner Cloud API → create CX22 server
3. Cloud-init script:
   a. Install HexOS platform
   b. Configure managed mode
   c. Set up client-specific audit token
   d. Configure egress allowlist
   e. Install Clawdbot gateway with client's Telegram bot token
   f. Start gateway + audit shipper
   g. Send first health ping to audit server
4. Operator verifies health on audit server dashboard
5. Client's AI agent is live
```

### Offboarding Flow

```
1. Operator runs: hexos teardown <client-name>
2. Final audit log export from audit server
3. Hetzner Cloud API → create server snapshot (archive)
4. Hetzner Cloud API → destroy server
5. Revoke client's audit server token
6. Archive audit data (retain per contract, default 90 days)
```

---

## Emergency Access (Break Glass)

For situations requiring direct server access (unresponsive agent, critical bug, etc.):

1. **Hetzner Console** — Web-based console access via Hetzner Cloud dashboard. No network path needed. Available even if server networking is broken.

2. **Temporary SSH** — If console isn't sufficient:
   - Generate temporary SSH key pair
   - Use Hetzner Cloud API to inject public key
   - SSH in, perform fix
   - Remove key immediately after
   - Log the access event to audit server

3. **Server Replacement** — If server is compromised:
   - Provision fresh server with `hexos provision`
   - Restore client workspace from latest backup
   - Destroy compromised server
   - Rotate client's audit token

**Rule:** Every break-glass access is logged and reported to the client if it involves their data.

---

## Cost Model

### Infrastructure (Operator-Side)

| Component | Spec | Monthly Cost |
|-----------|------|-------------|
| Control Plane | Existing server | €0 (already running) |
| Audit Server | CX22 (2 vCPU, 4GB, 40GB) | €4.15 |
| **Operator Total** | | **~€4/mo fixed** |

### Per-Client

| Component | Spec | Monthly Cost |
|-----------|------|-------------|
| Client Server | CX22 (2 vCPU, 4GB, 40GB) | €4.15 |
| Anthropic API | Pass-through + margin | Variable |
| Backups/Snapshots | Weekly snapshot | ~€1 |
| **Per-Client Total** | | **~€5/mo + API usage** |

### Scaling Examples

| Clients | Client Servers | Audit Server | Total Infra |
|---------|---------------|--------------|-------------|
| 1 | €4 | €4 | €8/mo |
| 5 | €20 | €4 | €24/mo |
| 10 | €40 | €4 | €44/mo |
| 25 | €100 | €8 (upgrade to CX32) | €108/mo |
| 50 | €200 | €16 (CX42) | €216/mo |

**Note:** At 25+ clients, audit server upgrades for storage/throughput. Client server costs scale linearly — no volume discounts needed since Hetzner pricing is already very competitive.

---

## Scaling Triggers

| Trigger | Action |
|---------|--------|
| 10+ clients | Evaluate audit server upgrade (CX22 → CX32) |
| 25+ clients | Add read replica for audit queries; consider PostgreSQL migration |
| Client needs GPU | Provision dedicated GPU server (Hetzner CCX or dedicated) |
| SOC 2 request | Enable Phase 3 Docker sandbox; formal access logging |
| Client in different region | Provision in different Hetzner datacenter (Ashburn, Singapore) |
| High-throughput client | Upgrade from CX22 to CX32/CX42 for that client |

---

## Security Summary

| Attack Vector | Mitigation |
|---------------|------------|
| Client server compromised | No path to operator or other clients. Can only push audit data. |
| Audit server compromised | Contains no secrets. Operator reads are authenticated separately. |
| Operator server compromised | No direct connection to client servers. Hetzner API access is the risk — rotate immediately. |
| Client-to-client attack | Completely separate servers. No shared anything. |
| Man-in-the-middle | All connections over HTTPS/TLS. Audit events have hash chain. |
| Audit log tampering | Hash chain breaks on tamper. Local + remote copies for cross-verification. |
| Rogue operator access | Break-glass protocol with mandatory logging. Future: client-visible access log. |
| Supply chain (bad update) | Updates are signed. Client server verifies signature before applying. |
| DDoS on audit server | Rate limiting per client. Audit server is not client-facing (no public URL). |

---

## Implementation Phases

### Phase A: Audit Server (Week 1)
- [ ] Provision CX22 on Hetzner
- [ ] Build ingest API (Node.js/Express, minimal)
- [ ] Per-client auth token system
- [ ] JSONL storage with daily rotation
- [ ] Hash chain verification on ingest
- [ ] Health ping endpoint
- [ ] Operator query/export API

### Phase B: Client Provisioning (Week 2)
- [ ] `hexos provision <client>` command using Hetzner Cloud API
- [ ] Cloud-init template for automated setup
- [ ] Audit shipper integration (cron-based HTTPS POST)
- [ ] Health ping integration
- [ ] `hexos teardown <client>` with snapshot + destroy

### Phase C: Update Distribution (Week 2-3)
- [ ] Release signing (GPG or HMAC)
- [ ] Update distributor on audit server
- [ ] Pull-based update client on client servers
- [ ] Rollback mechanism (keep previous version)

### Phase D: Fleet Management (Week 3)
- [ ] `hexos fleet status` — aggregated health view
- [ ] `hexos fleet update` — publish new release for all clients to pull
- [ ] Alert integration (Telegram notifications on health failures)
- [ ] Billing report generation from audit data

### Phase E: Jirka Migration (Week 4 — March 31)
- [ ] Provision Jirka's dedicated server
- [ ] Deploy HexOS managed mode
- [ ] Configure Telegram bot
- [ ] Verify audit shipping to audit server
- [ ] Monitor for 48 hours before declaring stable

---

## Open Questions

1. **Client-provided API keys vs operator-provided?** Current decision: operator-provided (Option A) for simplicity. Revisit when clients request it.

2. **Audit data format: JSONL files vs PostgreSQL?** Start with JSONL (consistent with local logs, zero dependencies). Migrate to PostgreSQL at 25+ clients or when query complexity demands it.

3. **Client dashboard: when to build?** Not for v1. Operator-only for now. Add when we have 3+ paying clients requesting visibility.

4. **Multi-region: when?** When a client needs low-latency in a different region. Hetzner has Ashburn (US) and Singapore (APAC) in addition to EU.

---

*This document defines the target architecture for HexOS multi-tenant operations. Implementation follows the phased approach above, with Jirka (first managed client) as the validation milestone.*
