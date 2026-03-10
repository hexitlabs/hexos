---
summary: "CLI reference for `hexos reset` (reset local state/config)"
read_when:
  - You want to wipe local state while keeping the CLI installed
  - You want a dry-run of what would be removed
---

# `hexos reset`

Reset local config/state (keeps the CLI installed).

```bash
hexos reset
hexos reset --dry-run
hexos reset --scope config+creds+sessions --yes --non-interactive
```

