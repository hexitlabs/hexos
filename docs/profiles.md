# HexOS Deployment Profiles v2

## Overview

HexOS v0.8.0 introduces a **capability-based profile system** with three presets and granular overrides. Every security-relevant action in HexOS passes through a capability gate — a fast property lookup on a frozen configuration object resolved at boot time.

### Why Three Tiers?

The original two-profile system (`operator` / `managed`) conflated two distinct personas:

- **Power users** who want full autonomy and no guardrails
- **Enterprise admins** who need control, audit trails, and cost limits

The new system separates these into three clear profiles:

| Profile | Target Audience | Philosophy |
|---------|----------------|------------|
| **Sovereign** | Developers, AI-native teams, HexIT Labs | "Full autonomy. I know what I'm doing." |
| **Operator** | Enterprise admins, fleet managers | "Control plane with guardrails and compliance." |
| **Managed** | Per-customer agent containers | "Lightweight, locked down. Operator controls everything." |

---

## Quick Start

### Choosing a Profile

**Use Sovereign if:**
- You're running HexOS on your own machine
- You want unrestricted shell, browser, and self-modification
- You trust your agent and want no approval gates
- You're a developer or power user

**Use Operator if:**
- You're managing agents for a team or customers
- You need audit trails, cost limits, and approval workflows
- You want exec restricted to an allowlist
- You need fleet management (v0.9.0)

**Use Managed if:**
- You're creating per-customer containers
- The container should be locked down with minimal capabilities
- An Operator instance controls this agent
- Never sold directly — always deployed under an Operator

### Setting Your Profile

In `hexos.json`:

```json
{
  "profile": "sovereign"
}
```

Or with overrides:

```json
{
  "profile": "sovereign",
  "capabilities": {
    "auditTrail": "local",
    "costLimits": {
      "monthlyDollars": 500,
      "alertAtPercent": 90
    }
  }
}
```

---

## Profile Comparison

### Execution Layer

| Capability | Sovereign | Operator | Managed |
|-----------|-----------|----------|---------|
| `exec` | unrestricted | allowlist¹ | disabled |
| `browser` | full | sandboxed² | disabled |
| `fileSystem` | full | workspace-only | workspace-only |
| `network` | unrestricted | egress-controlled | egress-controlled |

¹ Default allowlist: `git`, `npm`, `npx`, `node`, `cat`, `ls`, `grep`, `head`, `tail`, `wc`, `find`, `hexos`, `curl`
² Sandboxed: navigation allowlist, downloads blocked, extensions blocked

### Self-Modification Layer

| Capability | Sovereign | Operator | Managed |
|-----------|-----------|----------|---------|
| `selfUpdate` | yes | no | no |
| `skillInstall` | any | vetted-only | disabled |
| `configEdit` | yes | no | no |
| `workspaceEdit` | yes | yes | yes |
| `codeModification` | yes | no | no |

### Agent System Layer

| Capability | Sovereign | Operator | Managed |
|-----------|-----------|----------|---------|
| `agentSpawn` | unlimited | budget-limited | disabled |
| `agentConcurrency` | unlimited (-1) | 20 | 0 |
| `agentToolProfiles` | full, coding, minimal | coding, minimal | minimal |
| `agentCapabilityInheritance` | inherit | profile-default | profile-default |

### Guardrail Layer

| Capability | Sovereign | Operator | Managed |
|-----------|-----------|----------|---------|
| `approvalGates` | none | external-only | all |
| `auditTrail` | disabled | remote | remote |
| `leakScanner` | yes | yes | yes |
| `costLimits.monthlyDollars` | unlimited | $1,000 | $100 |
| `costLimits.perSessionDollars` | unlimited | $50 | $5 |
| `costLimits.perTaskDollars` | unlimited | $10 | $2 |
| `costLimits.alertAtPercent` | 80% | 80% | 70% |
| `externalAgentComms` | unrestricted | authenticated-only | disabled |

### Infrastructure Layer

| Capability | Sovereign | Operator | Managed |
|-----------|-----------|----------|---------|
| `channelBindings` | yes | yes | no |
| `cronScheduling` | yes | yes | yes |
| `vaultAccess` | full | full | injected-only |
| `httpServer` | yes | yes | no |
| `adminApi` | yes | yes | no |

---

## Override Reference

### General Rule

Profiles can opt **INTO** restrictions but not **OUT** of them:
- Sovereign can add audit trails, cost limits, or restrict exec
- Managed cannot enable shell access or remove audit requirements
- Operator can expand its exec allowlist but cannot switch to unrestricted

### Override Examples

**Sovereign with audit trail:**
```json
{
  "profile": "sovereign",
  "capabilities": {
    "auditTrail": "local",
    "costLimits": {
      "monthlyDollars": 2000
    }
  }
}
```

**Operator with expanded exec allowlist:**
```json
{
  "profile": "operator",
  "capabilities": {
    "exec": {
      "allowlist": ["git", "npm", "npx", "node", "cat", "ls", "grep",
                     "head", "tail", "wc", "find", "hexos", "curl",
                     "python3", "docker"]
    }
  }
}
```

**Sovereign with self-imposed restrictions:**
```json
{
  "profile": "sovereign",
  "capabilities": {
    "exec": { "mode": "allowlist", "allowlist": ["git", "npm", "node"] },
    "selfUpdate": false,
    "codeModification": false
  }
}
```

### What CAN'T Be Overridden

| Override Attempt | Profile | Result |
|-----------------|---------|--------|
| `exec.mode: "unrestricted"` | Managed | ❌ Blocked (escalation) |
| `auditTrail: "disabled"` | Operator | ❌ Blocked (can't disable audit) |
| `selfUpdate: true` | Managed | ❌ Blocked (escalation) |
| `leakScanner: false` | Any | ❌ Blocked (security feature) |
| `costLimits.monthlyDollars: null` | Operator | ❌ Blocked (can't remove limit) |
| `agentConcurrency: -1` | Operator | ❌ Blocked (can't set unlimited) |

---

## Exec Allowlist Reference

When `exec.mode` is `'allowlist'`, only whitelisted commands can execute.

### Default Operator Allowlist

```
git, npm, npx, node, cat, ls, grep, head, tail, wc, find, hexos, curl
```

### Matching Rules

- Matches the **first token** of the command (the binary name)
- **Exact match only** — no wildcards, no path prefixes
- **Pipe chains:** Every binary in the chain must be allowed
  - `cat file | grep pattern` → requires both `cat` and `grep`
- **Subshells:** Denied by default in allowlist mode
  - `bash -c "..."` requires `bash` in the allowlist (not recommended)

### Customizing the Allowlist

Add commands to the allowlist override:

```json
{
  "profile": "operator",
  "capabilities": {
    "exec": {
      "allowlist": ["git", "npm", "npx", "node", "cat", "ls", "grep",
                     "head", "tail", "wc", "find", "hexos", "curl",
                     "python3", "pip", "docker"]
    }
  }
}
```

> **Note:** Setting the allowlist replaces the default entirely. Include all commands you need.

---

## Browser Sandbox Reference

When `browser.mode` is `'sandboxed'`, these restrictions apply:

| Restriction | Default | Configurable? |
|-------------|---------|--------------|
| Navigation limited to allowlist | Yes (empty by default) | `browser.navigationAllowlist` |
| File downloads blocked | Yes | `browser.blockDownloads` |
| Extension access blocked | Yes | `browser.blockExtensions` |
| JavaScript execution | Allowed | No (always on) |
| Cookie persistence | Session-only | No |
| Cross-origin requests | Limited to allowlist domains | No |

### Configuring the Sandbox

```json
{
  "profile": "operator",
  "capabilities": {
    "browser": {
      "navigationAllowlist": ["github.com", "docs.anthropic.com", "stackoverflow.com"],
      "blockDownloads": false
    }
  }
}
```

---

## Migration Guide

### Upgrading from v0.5.0

If you're using the old `deploymentProfile` field:

```bash
hexos migrate-profile
```

This command:
1. Reads your current `deploymentProfile` value
2. Maps it to the new system:
   - `"operator"` → `"sovereign"` (current operator installs have full access)
   - `"managed"` → `"managed"` (direct mapping)
   - No profile → `"sovereign"` (default for self-installs)
3. Creates backup: `hexos.json.pre-migration`
4. Writes new `profile` field
5. Removes old `deploymentProfile` field
6. On any error → auto-restores from backup

### Why Does "operator" Map to "sovereign"?

The old `operator` profile gave unrestricted access — no exec restrictions, no audit trail, no cost limits. That matches **Sovereign** behavior, not the new **Operator** profile which has guardrails.

If you want the new Operator behavior (with audit trails and exec allowlists), explicitly set it:

```bash
hexos profile set operator
```

### Backward Compatibility

- v0.8.0 reads both `profile` (new) and `deploymentProfile` (legacy)
- If both are present, `profile` wins
- Boot logs warn if the old field is detected

---

## CLI Reference

### `hexos profile show`

Display the current profile and all resolved capabilities.

```bash
hexos profile show
```

Output:
```
Profile: sovereign
Overrides: 2

Execution:
  exec                         unrestricted
  browser                      full
  fileSystem                   full
  network                      unrestricted

Self-Modification:
  selfUpdate                   yes
  skillInstall                 any
  ...
```

### `hexos profile diff <profile1> <profile2>`

Compare two profile presets side-by-side. Only shows differences.

```bash
hexos profile diff sovereign operator
```

Output:
```
Differences: sovereign → operator

  exec.mode              unrestricted → allowlist
  browser.mode           full → sandboxed
  selfUpdate             yes → no
  approvalGates.mode     none → external-only
  auditTrail             disabled → remote
  ...
```

### `hexos profile set <profile>`

Switch to a different profile. Creates an automatic backup first.

```bash
hexos profile set operator
```

Output:
```
⚠️  Changing from sovereign to operator:

  exec.mode              unrestricted → allowlist
  browser.mode           full → sandboxed
  ...

Backup saved to .hexos-profile-backup.json
Restart required to apply changes.
```

### `hexos profile rollback`

Restore the previous profile from the automatic backup.

```bash
hexos profile rollback
```

Output:
```
Found backup: sovereign (from 2026-04-15T10:00:00Z)
Rolling back: operator → sovereign

  exec.mode              allowlist → unrestricted
  ...

Profile restored to "sovereign".
Restart required to apply changes.
```

### `hexos profile validate`

Check if the current config is valid.

```bash
hexos profile validate
```

Output:
```
✅ Profile "sovereign" with 2 overrides: valid
⚠️  auditTrail is "local" but no auditDir configured — will default to ./audit/
```

### `hexos profile explain <capability>`

Show detailed information about a specific capability.

```bash
hexos profile explain exec
```

Output:
```
exec — Shell command execution
Layer: Execution

Current value (sovereign): unrestricted

Possible values:
  unrestricted           Any command, no restrictions
  allowlist              Only commands in exec.allowlist
  disabled               No shell access

Profile defaults:
  sovereign    unrestricted
  operator     allowlist [git, npm, npx, ...]
  managed      disabled

Override rules:
  sovereign    can restrict (more restrictive values only)
  operator     can restrict mode, cannot escalate
  managed      can restrict (more restrictive values only)
```

---

## FAQ

### Can I create a custom profile?

Not in v0.8.0. Custom profiles (`profile: "custom"`) are planned for v0.10.0. For now, use one of the three presets with capability overrides.

### What happens if my config has invalid overrides?

HexOS **refuses to start**. Invalid configurations are never silently degraded. You'll see a clear error message explaining what's wrong and how to fix it.

### Do capability checks affect performance?

No measurable impact. Capability lookups are property reads from a frozen JavaScript object (~10 nanoseconds per check). At 25 checks per LLM call, that's 0.000005% of the LLM call latency.

### Can a sub-agent have more capabilities than its parent?

Never. The **Never Escalate Rule** ensures child capabilities can never exceed parent capabilities, regardless of inheritance mode.

### What about the fleet management capabilities?

Fleet capabilities (`tenantProvisioning`, `tenantManagement`, `fleetMonitoring`, `fleetConfigPush`) ship with v0.9.0 (Multi-Tenant Docker Runtime). The capability framework supports them — unknown capability keys in overrides emit a warning but don't block startup.

### How do I reset if something goes wrong?

```bash
hexos profile rollback
```

Or manually edit `hexos.json` and set `profile` back to your desired value. Backups are stored in `.hexos-profile-backup.json`.

### Can I change profiles without restarting?

Hot reload is planned for a future version. For now, profile changes require a restart to take effect.

### What's the default profile for new installs?

`sovereign`. If no profile is configured, HexOS defaults to sovereign — full access, no restrictions.
