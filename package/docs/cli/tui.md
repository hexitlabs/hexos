---
summary: "CLI reference for `hexos tui` (terminal UI connected to the Gateway)"
read_when:
  - You want a terminal UI for the Gateway (remote-friendly)
  - You want to pass url/token/session from scripts
---

# `hexos tui`

Open the terminal UI connected to the Gateway.

Related:
- TUI guide: [TUI](/tui)

## Examples

```bash
hexos tui
hexos tui --url ws://127.0.0.1:18789 --token <token>
hexos tui --session main --deliver
```

