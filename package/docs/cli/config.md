---
summary: "CLI reference for `hexos config` (get/set/unset config values)"
read_when:
  - You want to read or edit config non-interactively
---

# `hexos config`

Config helpers: get/set/unset values by path. Run without a subcommand to open
the configure wizard (same as `hexos configure`).

## Examples

```bash
hexos config get browser.executablePath
hexos config set browser.executablePath "/usr/bin/google-chrome"
hexos config set agents.defaults.heartbeat.every "2h"
hexos config set agents.list[0].tools.exec.node "node-id-or-name"
hexos config unset tools.web.search.apiKey
```

## Paths

Paths use dot or bracket notation:

```bash
hexos config get agents.defaults.workspace
hexos config get agents.list[0].id
```

Use the agent list index to target a specific agent:

```bash
hexos config get agents.list
hexos config set agents.list[1].tools.exec.node "node-id-or-name"
```

## Values

Values are parsed as JSON5 when possible; otherwise they are treated as strings.
Use `--json` to require JSON5 parsing.

```bash
hexos config set agents.defaults.heartbeat.every "0m"
hexos config set gateway.port 19001 --json
hexos config set channels.whatsapp.groups '["*"]' --json
```

Restart the gateway after edits.
