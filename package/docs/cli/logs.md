---
summary: "CLI reference for `hexos logs` (tail gateway logs via RPC)"
read_when:
  - You need to tail Gateway logs remotely (without SSH)
  - You want JSON log lines for tooling
---

# `hexos logs`

Tail Gateway file logs over RPC (works in remote mode).

Related:
- Logging overview: [Logging](/logging)

## Examples

```bash
hexos logs
hexos logs --follow
hexos logs --json
hexos logs --limit 500
```

