---
summary: "CLI reference for `hexos plugins` (list, install, enable/disable, doctor)"
read_when:
  - You want to install or manage in-process Gateway plugins
  - You want to debug plugin load failures
---

# `hexos plugins`

Manage Gateway plugins/extensions (loaded in-process).

Related:
- Plugin system: [Plugins](/plugin)
- Plugin manifest + schema: [Plugin manifest](/plugins/manifest)
- Security hardening: [Security](/gateway/security)

## Commands

```bash
hexos plugins list
hexos plugins info <id>
hexos plugins enable <id>
hexos plugins disable <id>
hexos plugins doctor
hexos plugins update <id>
hexos plugins update --all
```

Bundled plugins ship with HexOS but start disabled. Use `plugins enable` to
activate them.

All plugins must ship a `hexos.plugin.json` file with an inline JSON Schema
(`configSchema`, even if empty). Missing/invalid manifests or schemas prevent
the plugin from loading and fail config validation.

### Install

```bash
hexos plugins install <path-or-spec>
```

Security note: treat plugin installs like running code. Prefer pinned versions.

Supported archives: `.zip`, `.tgz`, `.tar.gz`, `.tar`.

Use `--link` to avoid copying a local directory (adds to `plugins.load.paths`):

```bash
hexos plugins install -l ./my-plugin
```

### Update

```bash
hexos plugins update <id>
hexos plugins update --all
hexos plugins update <id> --dry-run
```

Updates only apply to plugins installed from npm (tracked in `plugins.installs`).
