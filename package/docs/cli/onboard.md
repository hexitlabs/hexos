---
summary: "CLI reference for `hexos onboard` (interactive onboarding wizard)"
read_when:
  - You want guided setup for gateway, workspace, auth, channels, and skills
---

# `hexos onboard`

Interactive onboarding wizard (local or remote Gateway setup).

Related:
- Wizard guide: [Onboarding](/start/onboarding)

## Examples

```bash
hexos onboard
hexos onboard --flow quickstart
hexos onboard --flow manual
hexos onboard --mode remote --remote-url ws://gateway-host:18789
```

Flow notes:
- `quickstart`: minimal prompts, auto-generates a gateway token.
- `manual`: full prompts for port/bind/auth (alias of `advanced`).
