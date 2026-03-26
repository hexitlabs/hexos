# HexOS Vault

Encrypted credential storage for HexOS. Secrets are stored encrypted at rest, decrypted only in gateway memory, injected at tool execution boundaries, and never exposed to the model context.

## Overview

The HexOS Vault solves a critical security gap: API keys, tokens, and secrets were previously stored as plaintext in `hexos.json`. The model could see these values in its context window, and prompt injection attacks could potentially exfiltrate them.

With the vault:
- Secrets are encrypted on disk using AES-256-GCM
- The encryption key is derived from your device's private key via HKDF-SHA256
- Config references use `$vault:NAME` placeholders that resolve at gateway boot
- The model context only ever sees `$vault:NAME`, never actual values
- Two-pass leak detection scans outbound requests and inbound responses
- Every vault access is logged to an audit trail

## Quick Start

```bash
# Store a secret
hexos secrets set ANTHROPIC_KEY "sk-ant-api03-..."

# Store from environment variable
hexos secrets set OPENAI_KEY --from-env OPENAI_API_KEY

# Store from file
hexos secrets set GH_TOKEN --from-file ~/.gh/token

# List secrets (values redacted)
hexos secrets list

# Auto-migrate plaintext keys from hexos.json
hexos secrets migrate --dry-run  # preview first
hexos secrets migrate            # apply
```

## CLI Commands

### `hexos secrets set <name> [value]`

Add or update a secret in the vault.

**Options:**
- `--from-env <VAR>` — Read value from an environment variable
- `--from-file <path>` — Read value from a file
- `--tags <tags>` — Comma-separated tags for organization
- `--allowed-endpoints <patterns>` — Comma-separated URL patterns where this secret may be sent
- `--used-by <paths>` — Config paths that reference this secret

**Examples:**
```bash
hexos secrets set BRAVE_API_KEY "BSA-xxx..." --tags search,brave
hexos secrets set ANTHROPIC_KEY "sk-ant-..." --allowed-endpoints "https://api.anthropic.com/*"
hexos secrets set DB_PASSWORD --from-env DATABASE_PASSWORD
```

### `hexos secrets list`

List all secrets with redacted values.

```
NAME              VALUE          CREATED     USED BY
─────────────────────────────────────────────────────
ANTHROPIC_KEY     sk-a...xxx     2026-03-26  models.providers.anthropic
BRAVE_API_KEY     BSA-...xxx     2026-03-26  tools.web.search
TELEGRAM_TOKEN    1234...xxx     2026-03-26  channels.telegram
```

### `hexos secrets remove <name>`

Remove a secret from the vault.

### `hexos secrets rotate <name> <new-value>`

Update a secret's value and log a rotation event in the audit trail.

### `hexos secrets migrate`

Automatically scan `hexos.json` for plaintext secrets and migrate them to the vault.

**What it does:**
1. Scans config for fields like `apiKey`, `botToken`, `token`, `secret`, `password`
2. Detects known key formats (Anthropic, OpenAI, GitHub, Brave, NVIDIA, Telegram, AWS)
3. Stores each in the vault with appropriate metadata
4. Replaces config values with `$vault:NAME` references
5. Backs up original config as `hexos.json.pre-vault`

**Options:**
- `--dry-run` — Preview without making changes
- `--overwrite` — Overwrite existing vault secrets

### `hexos secrets export`

Export the vault encrypted with a passphrase (for backup or migration to another server).

```bash
hexos secrets export --passphrase "backup-pass" -o secrets.backup
```

### `hexos secrets import <file>`

Import vault from an encrypted backup.

```bash
hexos secrets import secrets.backup --passphrase "backup-pass"
hexos secrets import secrets.backup --passphrase "backup-pass" --merge  # merge with existing
```

### `hexos secrets audit`

Show vault access log.

```bash
hexos secrets audit                    # last 50 events
hexos secrets audit --secret API_KEY   # filter by secret
hexos secrets audit --event vault.leak_detected  # filter by event type
hexos secrets audit --json             # machine-readable
```

## Config Integration

After migration, your `hexos.json` uses vault references instead of plaintext:

**Before:**
```json5
{
  models: {
    providers: {
      anthropic: {
        apiKey: "sk-ant-api03-REAL-KEY-HERE..."
      }
    }
  },
  channels: {
    telegram: {
      botToken: "1234567890:REAL-TOKEN-HERE..."
    }
  }
}
```

**After:**
```json5
{
  models: {
    providers: {
      anthropic: {
        apiKey: "$vault:ANTHROPIC_APIKEY"
      }
    }
  },
  channels: {
    telegram: {
      botToken: "$vault:TELEGRAM_BOTTOKEN"
    }
  }
}
```

At gateway boot, `$vault:NAME` references are resolved from the encrypted vault into memory. The model context, session transcripts, and logs only ever see `$vault:NAME`.

## Leak Detection

The vault includes a two-pass leak detection engine:

### Outbound Scan
Before every HTTP request, the scanner checks if any vault secret values appear in the URL, headers, or body. If a secret is found being sent to a non-allowed endpoint, the request is **blocked**.

### Inbound Scan
Before tool responses enter the model context, the scanner checks for vault values and **redacts** them, replacing with `$vault:NAME` placeholders.

### Pattern-Based Scanning
Even for non-vault secrets, known patterns are detected:
- API keys (`sk-*`, `sk-ant-*`)
- AWS keys (`AKIA*`)
- JWTs (`eyJ*`)
- Private keys
- Bot tokens
- GitHub PATs (`ghp_*`, `gho_*`)
- NVIDIA keys (`nvapi-*`)

### Endpoint Allowlisting
Each secret can define allowed endpoints:

```bash
hexos secrets set ANTHROPIC_KEY "sk-ant-..." --allowed-endpoints "https://api.anthropic.com/*"
```

If the model tries to send `ANTHROPIC_KEY` to `https://evil.com`, the outbound scan blocks it.

## Audit Trail

Every vault operation is logged to `~/.hexos/audit/vault.jsonl`:

- `vault.set` / `vault.update` — Secret created or updated
- `vault.access` — Secret read or injected
- `vault.rotation` — Secret rotated
- `vault.migration` — Secrets migrated from config
- `vault.leak_detected` — Leak detected and blocked/redacted
- `vault.export` / `vault.import` — Vault exported or imported
- `vault.remove` — Secret removed

## Security Architecture

```
┌─────────────────────────────────────────────┐
│              MODEL CONTEXT                   │
│  "Use $vault:BRAVE_API_KEY for web search"  │
│  (Model sees ONLY placeholders)              │
└──────────────────┬──────────────────────────┘
                   │ Tool call
                   ▼
┌─────────────────────────────────────────────┐
│         TOOL EXECUTION MIDDLEWARE            │
│  1. OUTBOUND LEAK SCAN                      │
│  2. INJECT $vault:NAME → real values        │
│  3. EXECUTE HTTP request                    │
│  4. INBOUND LEAK SCAN                       │
│  5. REDACT leaked values                    │
│  6. Return sanitized response to model      │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│              HEXOS VAULT                     │
│  ~/.hexos/vault.enc (AES-256-GCM)          │
│  Key: HKDF-SHA256(device private key)       │
└─────────────────────────────────────────────┘
```

## Encryption Details

- **Algorithm:** AES-256-GCM (authenticated encryption)
- **Key derivation:** HKDF-SHA256 from the device Ed25519 private key
- **IV:** Unique 96-bit random IV per encryption
- **Authentication:** GCM provides built-in authentication tags
- **At rest:** `~/.hexos/vault.enc` with mode 0600
- **In memory:** Decrypted values held only in gateway process memory
- **Export:** PBKDF2 (100,000 iterations) + AES-256-GCM for passphrase-protected backups

## FAQ

**Q: What happens if I lose my device key?**
A: The vault becomes unrecoverable. Use `hexos secrets export` to create passphrase-protected backups.

**Q: Can I move the vault to a new server?**
A: Yes. Use `hexos secrets export --passphrase "pass"` on the old server, then `hexos secrets import` on the new one.

**Q: Does the vault work without a device identity?**
A: No. Run `hexos configure` first to generate a device identity at `~/.hexos/identity/device.json`.

**Q: Are existing plaintext configs still supported?**
A: Yes. The vault is opt-in. Plaintext keys in `hexos.json` continue to work. Use `hexos secrets migrate` when ready.
