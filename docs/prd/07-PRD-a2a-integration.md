# PRD 07 — A2A Protocol Integration

*Version: 1.0 · March 25, 2026*
*Status: Approved*
*Priority: Medium — Ship after Jirka migration (Q2 2026)*

---

## Overview

Integrate Google's Agent2Agent (A2A) open protocol into HexOS, enabling managed client agents to communicate with external AI agents across different platforms, frameworks, and vendors. A2A is the emerging industry standard for agent interoperability, backed by 50+ enterprise partners (Salesforce, SAP, Atlassian, PayPal, Workday, etc.) and now governed by the Linux Foundation.

**One-liner:** Let HexOS agents talk to any A2A-compatible agent in the world — securely, with full audit trail.

---

## Why Now

1. **Enterprise demand** — Clients using Salesforce, SAP, ServiceNow are already deploying agents on those platforms. They'll want their HexOS agent to collaborate with them.
2. **Industry momentum** — 50+ partners, Google-backed, Linux Foundation governance, official SDKs in 5 languages. This is becoming the standard.
3. **Competitive moat** — Most agent platforms can't do this securely. Our Shield + Vigil + audit trail stack makes us one of the few who can offer A2A with enterprise-grade security.
4. **Complements MCP** — MCP (Anthropic) = agent-to-tool. A2A (Google) = agent-to-agent. Supporting both makes HexOS the most interoperable platform available.

---

## What A2A Is

A2A is an open protocol built on HTTP, JSON-RPC 2.0, and SSE. It defines:

- **Agent Cards** — JSON documents describing an agent's capabilities, skills, auth requirements, and connection info. Used for discovery.
- **Tasks** — The unit of work. A client agent sends a task to a remote agent. Tasks have lifecycle states (submitted, working, completed, failed, canceled).
- **Messages** — Rich content exchange between agents during task execution. Supports text, files, structured JSON, and multimedia.
- **Artifacts** — The output of a completed task.

**Protocol:** JSON-RPC 2.0 over HTTPS (also supports REST and gRPC)
**SDK:** `@a2a-js/sdk` (npm) — official JavaScript/TypeScript SDK, v0.3.10
**Spec:** v0.3.0 at [a2a-protocol.org](https://a2a-protocol.org)

---

## Architecture

### How It Fits Into HexOS

```
                    INBOUND (Server)                    OUTBOUND (Client)
                    
External Agent                                  HexOS Agent
     │                                               │
     ▼                                               ▼
[HTTPS Endpoint]                              [A2A Client Skill]
     │                                               │
     ▼                                               ▼
[Auth Gate]                                   [Egress Allowlist Check]
     │                                               │
     ▼                                               ▼
[Rate Limiter]                                [Shield Scanner]
     │                                               │
     ▼                                               ▼
[Shield Scanner — scan inbound content]       [Credential Sanitizer]
     │                                               │
     ▼                                               ▼
[Vigil — prompt injection check]              [External A2A Agent]
     │                                               │
     ▼                                               ▼
[Isolated Session — no main memory access]    [Response → Audit Trail]
     │
     ▼
[Agent processes task]
     │
     ▼
[Credential Sanitizer — strip secrets from response]
     │
     ▼
[Audit Trail — log full interaction]
     │
     ▼
[Response → External Agent]
```

### Deployment Model

```
[Client Server (Dedicated)]
  │
  ├── HexOS Gateway (existing)
  │     └── Telegram/WhatsApp/etc channels
  │
  └── A2A Endpoint (new)
        ├── /.well-known/agent.json  (Agent Card)
        ├── /a2a/jsonrpc             (JSON-RPC handler)
        └── Auth: API key per partner
```

The A2A endpoint runs on the same client server as the gateway but on a separate port. It shares the same security stack (Shield, Vigil, audit trail) but uses isolated sessions so external agents never access the client's primary conversation history or memory.

---

## Features

### Phase A: A2A Server (Inbound)

External agents can discover and send tasks to HexOS agents.

| Feature | Description |
|---------|-------------|
| **Agent Card** | Auto-generated from gateway config. Exposes agent name, description, skills (derived from installed skills), supported modes, auth requirements. Served at `/.well-known/agent.json`. |
| **Task Handler** | Receives tasks via JSON-RPC, creates isolated session, routes to agent for processing. Returns artifacts. |
| **Auth Gate** | Mandatory API key authentication. No anonymous access. Keys issued per partner via `hexos a2a partner add <name>`. |
| **Rate Limiting** | Per-partner limits: configurable tasks/minute (default: 10), concurrent tasks (default: 3). |
| **Session Isolation** | Each A2A task runs in its own session. No access to the agent's primary memory, conversation history, or other A2A sessions. |
| **Security Pipeline** | Every inbound message passes through: Shield scanner → Vigil → agent. Every outbound response passes through: credential sanitizer → audit log. |
| **Streaming** | Support SSE for long-running tasks. Agent can send progress updates as the task executes. |
| **Task Lifecycle** | Full lifecycle support: submitted → working → completed/failed/canceled. Client agents can poll status or subscribe to SSE stream. |

### Phase B: A2A Client (Outbound)

HexOS agents can discover and send tasks to external A2A agents.

| Feature | Description |
|---------|-------------|
| **Discovery** | `hexos a2a discover <url>` — Fetch and display an external agent's Agent Card. Show capabilities, skills, auth requirements. |
| **Send Task** | New tool for agents: `a2a_send_task(agent_url, task_description)`. Agent can delegate work to external A2A agents. |
| **Egress Integration** | External A2A endpoints must be in the client's egress allowlist. No open federation. `hexos egress allow <client> <a2a-agent-url>` |
| **Response Handling** | Parse artifacts from external agents, present to the HexOS agent for further processing. |
| **Approval Gate** | First-time connections to new A2A agents require operator approval (via approval system). Subsequent tasks to approved agents proceed automatically. |
| **Audit Trail** | Log every outbound task: destination, content sent, response received, duration, status. |

### Phase C: Management CLI

| Command | Description |
|---------|-------------|
| `hexos a2a status` | Show A2A endpoint status, connected partners, active tasks |
| `hexos a2a partner add <name>` | Create API key for a new A2A partner |
| `hexos a2a partner list` | List registered partners with stats |
| `hexos a2a partner revoke <name>` | Revoke partner access |
| `hexos a2a card` | Display this agent's Agent Card |
| `hexos a2a card update` | Regenerate Agent Card from current config |
| `hexos a2a discover <url>` | Fetch and display an external agent's capabilities |
| `hexos a2a log [partner]` | View A2A interaction log |
| `hexos a2a test <partner> <message>` | Send a test task to verify connectivity |

---

## Security Model

### Non-Negotiable Rules

1. **A2A is OFF by default.** Must be explicitly enabled per client: `hexos a2a enable`.
2. **No anonymous access.** Every inbound request requires a valid API key.
3. **No open federation.** Partners are explicitly registered. No auto-discovery by external agents scanning the internet.
4. **Isolated sessions.** A2A tasks cannot access the agent's primary memory, conversation history, or workspace files.
5. **Full security pipeline.** Every inbound message: Shield scan → Vigil check → agent. Every outbound response: credential sanitizer → audit log.
6. **Outbound allowlisting.** A2A client calls only to explicitly allowlisted endpoints.
7. **Rate limiting.** Per-partner, configurable, enforced at the transport layer.
8. **Audit everything.** Every A2A interaction logged in tamper-evident audit trail.

### Threat Model

| Threat | Mitigation |
|--------|------------|
| Prompt injection via A2A message | Vigil scans all inbound content. Shield detects exfiltration patterns. Isolated session prevents access to sensitive context. |
| Credential theft via crafted task | Credential sanitizer strips 30+ secret patterns from all outbound responses. Agent runs in workspace jail with no access to operator secrets. |
| Task spam / resource exhaustion | Per-partner rate limiting. Max concurrent tasks. API token budget limits (future). |
| Unauthorized discovery | Agent Card not publicly indexed. Served only to authenticated requests (optional: can be made public for marketplace listing). |
| Data exfiltration via "collaboration" | Shield scanner checks outbound content. Approval system gates first-time connections. Audit trail logs everything for review. |
| Man-in-the-middle | HTTPS/TLS required. No plaintext A2A. |
| Partner key compromise | Keys are per-partner and revocable. `hexos a2a partner revoke` instantly kills access. Audit trail shows which key was used. |
| Supply chain (SDK) | `@a2a-js/sdk` is Google-backed, Apache 2.0, under Linux Foundation. Pin version, audit before updates. |

---

## Configuration

### hexos.yaml additions

```yaml
a2a:
  enabled: false                    # Off by default
  port: 3000                        # A2A endpoint port (separate from gateway)
  host: "0.0.0.0"
  tls:
    enabled: true                   # Require HTTPS
    cert: "/hexos/platform/certs/a2a.pem"
    key: "/hexos/platform/certs/a2a.key"
  rate_limit:
    tasks_per_minute: 10            # Per partner
    max_concurrent: 3               # Per partner
  session:
    isolation: true                 # Mandatory — cannot be disabled in managed mode
    max_duration_seconds: 300       # Task timeout
    max_tokens_per_task: 50000      # Token budget per task
  agent_card:
    public: false                   # If true, /.well-known/agent.json is unauthenticated
    custom_description: ""          # Override auto-generated description
    custom_skills: []               # Additional skills to advertise
  partners: []                      # Managed via CLI
```

### Deployment Profile Integration

| Setting | Operator Mode | Managed Mode |
|---------|--------------|--------------|
| A2A available | Yes | Yes (opt-in) |
| Public Agent Card | Configurable | Must be false (auth required) |
| Session isolation | Configurable | Always true (enforced) |
| Partner management | Self-service | Operator manages |
| Rate limits | Configurable | Operator sets minimums |

---

## Dependencies

| Dependency | Version | Purpose | Risk |
|------------|---------|---------|------|
| `@a2a-js/sdk` | ^0.3.10 | A2A protocol implementation | Low — Google/Linux Foundation backed |
| `express` | Already in HexOS | HTTP server for A2A endpoint | None — existing dependency |
| Shield (Phase 1.5) | v0.3.0+ | Scan inbound/outbound content | None — already shipped |
| Vigil | v1.x | Prompt injection detection | None — already shipped |
| Audit Trail (Phase 6) | v0.6.0+ | Log all A2A interactions | None — already shipped |
| Egress Control (Phase 2) | v0.4.0+ | Allowlist outbound A2A endpoints | None — already shipped |

---

## Implementation Timeline

| Phase | What | Effort | Depends On |
|-------|------|--------|------------|
| **A: Server (Inbound)** | Agent Card, task handler, auth gate, rate limiter, security pipeline, isolated sessions | 3 days | Shield, Vigil, Audit Trail |
| **B: Client (Outbound)** | Discovery, send_task tool, egress integration, approval gate | 2 days | Phase A, Egress Control |
| **C: Management CLI** | Partner management, status, logging, testing commands | 1 day | Phase A |
| **D: Testing & Docs** | Integration tests, security tests, documentation | 1 day | All phases |
| **Total** | | **~7 days** | |

**Target:** Q2 2026, after Jirka migration is stable.

---

## Success Metrics

| Metric | Target |
|--------|--------|
| A2A tasks processed without security incidents | 100% |
| Inbound prompt injection caught by Vigil/Shield | >95% |
| Task completion rate | >90% |
| Average task latency (simple tasks) | <5 seconds |
| Zero credential leaks via A2A responses | 0 incidents |
| Partner onboarding time | <5 minutes |

---

## Future Enhancements (Post-MVP)

- **A2A Marketplace listing** — Register HexOS agents in Google Agentspace or similar directories
- **Token budget per partner** — Limit API token spend per A2A partner per billing period
- **Multi-modal support** — Accept/return images, audio, video via A2A
- **Webhook push notifications** — Notify partners when long-running tasks complete
- **MCP bridge** — Expose MCP tools via A2A interface (tools-as-agents)
- **A2A analytics dashboard** — Visual overview of A2A traffic, partners, costs

---

## Open Questions

1. **Should A2A be a separate port or a path on the existing gateway?** Current design: separate port for clean separation. Alternative: `/a2a/*` path on gateway port with auth middleware.
2. **Token budget enforcement — per task or per partner per day?** Start with per-task limit, add daily budgets later.
3. **Should we build a simple A2A testing tool?** Like `hexos a2a test` that acts as a mock external agent for clients to verify their setup.

---

*This PRD defines the A2A protocol integration for HexOS. Implementation follows the phased approach, starting after the Jirka migration is stable (April 2026).*
