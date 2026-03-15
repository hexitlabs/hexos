# HexOS Vigil

## What It Does
Safety layer for AI agent actions. Vigil intercepts tool calls and evaluates them against configurable policies before execution. Prevents destructive, unauthorized, or risky actions.

## How It Works

1. Agent requests a tool call (e.g., `rm -rf /`, `send email`, `exec command`)
2. Vigil evaluates the action against the active policy
3. **Allow** — action proceeds normally
4. **Deny** — action is blocked, agent is informed
5. **Ask** — user is prompted for confirmation

## Policies

Three built-in policy levels in `policies/`:

### Permissive (`permissive.json`)
- Most actions allowed by default
- Only blocks clearly destructive operations
- Good for: trusted environments, development

### Moderate (`moderate.json`)
- Balanced safety — allows reads, prompts for writes
- External actions (email, API calls) require confirmation
- Good for: daily use, personal assistants

### Restrictive (`restrictive.json`)
- Deny by default, allowlist approved actions
- All external actions blocked unless explicitly permitted
- Good for: shared environments, production

## Configuration

In your HexOS config, set the Vigil policy:

```json
{
  "vigil": {
    "enabled": true,
    "policy": "moderate"
  }
}
```

## Custom Policies

Create your own policy JSON file following the same schema as the built-in policies. Reference it by path:

```json
{
  "vigil": {
    "policy": "./my-custom-policy.json"
  }
}
```

## What Gets Checked

- **Shell commands** — destructive patterns, sudo, rm, etc.
- **File operations** — writes to sensitive paths
- **External actions** — emails, API calls, messages
- **Network** — outbound connections to unknown hosts

## Privacy
- All evaluation happens locally
- No data sent externally
- Policies are plain JSON — fully auditable

## Built by HexIT Labs 🔷
