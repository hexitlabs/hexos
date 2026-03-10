---
summary: "CLI reference for `hexos dns` (wide-area discovery helpers)"
read_when:
  - You want wide-area discovery (DNS-SD) via Tailscale + CoreDNS
  - You’re setting up split DNS for hexos.internal
---

# `hexos dns`

DNS helpers for wide-area discovery (Tailscale + CoreDNS). Currently focused on macOS + Homebrew CoreDNS.

Related:
- Gateway discovery: [Discovery](/gateway/discovery)
- Wide-area discovery config: [Configuration](/gateway/configuration)

## Setup

```bash
hexos dns setup
hexos dns setup --apply
```

