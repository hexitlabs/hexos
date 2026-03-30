# HexOS Setup Guide

> **The OS for AI-powered businesses.**
> Deploy AI agents that work 24/7 across Telegram, Discord, Slack, WhatsApp, Signal, and more.

---

## Table of Contents

1. [Requirements](#requirements)
2. [Install HexOS](#install-hexos)
3. [Run the Setup Wizard](#run-the-setup-wizard)
4. [Start the Gateway](#start-the-gateway)
5. [Talk to Your Agent](#talk-to-your-agent)
6. [Health Check](#health-check)
7. [Customize Your Agent](#customize-your-agent)
8. [VPS / Always-On Setup](#vps--always-on-setup)
9. [Server Security](#server-security)
10. [Common Issues](#common-issues)

---

## Requirements

| Requirement | Details |
|-------------|---------|
| **Node.js** | v22 or higher ([download](https://nodejs.org/)) |
| **OS** | macOS, Linux, or Windows (via WSL2) |
| **AI Provider** | Anthropic API key (recommended), OpenAI, Google, or others |
| **Chat Platform** | Telegram bot token, Discord bot, Slack app, etc. |

---

## Install HexOS

### Option A: One-Line Installer (Recommended)

```bash
curl -fsSL https://clawd.bot/install.sh | bash
```

Windows (PowerShell):
```powershell
iwr -useb https://clawd.bot/install.ps1 | iex
```

This installs the `hexos` CLI globally and runs onboarding automatically.

### Option B: Manual Install via npm

```bash
npm install -g @hexitlabs/hexos@latest
```

Verify it worked:

```bash
hexos --version
```

Then run onboarding:

```bash
hexos onboard --install-daemon
```

### Option C: From Source (Contributors)

```bash
git clone https://github.com/hexitlabs/hexos.git
cd hexos
pnpm install
pnpm build
hexos onboard --install-daemon
```

---

## Run the Setup Wizard

```bash
hexos setup
```

The wizard walks you through everything:

1. **AI Provider** — Select your provider (Anthropic recommended) and enter your API key
2. **Default Model** — Pick which model powers your agent (e.g. `claude-sonnet-4-20250514`)
3. **Messaging Channel** — Choose a platform (Telegram, Discord, Slack, WhatsApp, Signal)
4. **Bot Token** — Enter the token for your messaging bot
5. **Agent Identity** — Name your agent and optionally pick a template

### Start with a Template

Skip the blank canvas — use a pre-built agent personality:

```bash
hexos setup --template ceo
```

| Template | Description |
|----------|-------------|
| `ceo` | Strategic business partner and operations manager |
| `researcher` | Deep research analyst with verification frameworks |
| `writer` | Content writer with editorial standards |
| `coder` | Senior developer with code review practices |
| `trader` | Financial analyst with structured market analysis |
| `support` | Customer support agent with escalation protocols |

### Setting Up Telegram (Most Popular)

1. Open Telegram → search **@BotFather**
2. Send `/newbot` and follow the prompts
3. Copy the bot token (looks like `123456:ABCdef...`)
4. Paste it when the setup wizard asks for your Telegram token

Minimal config (if editing manually):
```json5
{
  channels: {
    telegram: {
      enabled: true,
      botToken: "YOUR_BOT_TOKEN",
      dmPolicy: "pairing"
    }
  }
}
```

---

## Start the Gateway

The Gateway is the core daemon that routes messages between your AI provider and your chat platforms.

```bash
hexos gateway start
```

Check it's running:

```bash
hexos gateway status
```

You should see the gateway marked as **active**.

### Gateway Commands

| Command | What it does |
|---------|-------------|
| `hexos gateway start` | Start the daemon |
| `hexos gateway stop` | Stop the daemon |
| `hexos gateway restart` | Restart (picks up config changes) |
| `hexos gateway status` | Check if it's running |
| `hexos status` | Full system status overview |
| `hexos health` | Detailed health check |

---

## Talk to Your Agent

Open your messaging app and send your bot a message. It should respond immediately.

Try:
- *"Hello, who are you?"*
- *"What can you do?"*
- *"Search the web for the latest AI news"*

**First-time DM access** uses pairing by default — you'll get a pairing code to approve.

---

## Health Check

Run the built-in diagnostics:

```bash
hexos doctor
```

This checks:
- ✅ Node.js version compatibility
- ✅ API key validity
- ✅ Gateway connectivity
- ✅ Channel configuration
- ✅ Workspace integrity

---

## Customize Your Agent

Your agent's personality and behavior live in your **workspace** (default: `~/clawd`).

### Key Files

| File | Purpose |
|------|---------|
| `SOUL.md` | Agent personality, tone, values, and behavior |
| `USER.md` | Info about you (so the agent knows who it's helping) |
| `IDENTITY.md` | Agent name, role, avatar, backstory |
| `AGENTS.md` | Multi-agent coordination rules |
| `TOOLS.md` | Tool usage notes and preferences |

### Configuration

Main config lives at `~/.hexos/hexos.json`. Edit directly or use:

```bash
hexos configure
```

Common config sections:
- **Channels** — Add/modify messaging platforms
- **Tools** — Enable web search (Brave API), browser, TTS, etc.
- **Memory** — Configure persistent recall
- **Skills** — Install community skills from ClawdHub

### Install Skills

Browse available skills:

```bash
hexos skills search
```

Install one:

```bash
hexos skills install <skill-name>
```

Or browse the community hub at [clawdhub.com](https://clawdhub.com).

---

## VPS / Always-On Setup

Want your agent running 24/7? Deploy on a VPS.

### Quick Path (Hetzner, ~€4/mo)

1. **Provision a VPS** — Ubuntu/Debian, smallest tier works fine
2. **SSH in** — `ssh root@YOUR_IP`
3. **Install Node.js 22+**:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
   apt-get install -y nodejs
   ```
4. **Install HexOS**:
   ```bash
   npm install -g @hexitlabs/hexos@latest
   ```
5. **Run setup**:
   ```bash
   hexos setup
   ```
6. **Start with daemon**:
   ```bash
   hexos onboard --install-daemon
   ```

The daemon installs a **systemd service** that auto-starts on boot and restarts on crash.

**Important:** Enable lingering so the service survives SSH logout:
```bash
sudo loginctl enable-linger $USER
```

### Docker Setup

For containerized deployments, see the [Docker guide](https://docs.clawd.bot/install/docker) or the [Hetzner production guide](https://docs.clawd.bot/platforms/hetzner).

### Server Security (One Command)

Harden your server with firewall, SSH lockdown, and fail2ban:

```bash
hexos secure
```

---

## Common Issues

### `sharp` fails to install
```bash
SHARP_IGNORE_GLOBAL_LIBVIPS=1 npm install -g @hexitlabs/hexos@latest
```

### Gateway won't start
```bash
hexos doctor          # Check for config issues
hexos gateway status  # Check daemon state
hexos health          # Full health report
```

### Agent not responding in Telegram
1. Check the bot token is correct in config
2. Make sure the gateway is running (`hexos gateway status`)
3. Check DM policy — if `pairing`, approve the pairing code first
4. Ensure BotFather privacy mode allows message access in groups

### Wrong Node.js version
```bash
node --version  # Must be 22+
```

Install/update via [nvm](https://github.com/nvm-sh/nvm):
```bash
nvm install 22
nvm use 22
```

### Config location
- **Config:** `~/.hexos/hexos.json`
- **Workspace:** `~/clawd/`
- **Credentials:** `~/.hexos/credentials/`
- **Logs:** `/tmp/hexos/`

---

## Next Steps

- 📖 **Full docs:** [docs.clawd.bot](https://docs.clawd.bot)
- 🧩 **Skills marketplace:** [clawdhub.com](https://clawdhub.com)
- 💬 **Community:** [discord.com/invite/clawd](https://discord.com/invite/clawd)
- 🐙 **Source:** [github.com/hexitlabs/hexos](https://github.com/hexitlabs/hexos)

---

*Built by [HexIT Labs](https://hexitlabs.com) — 1 founder, 38 AI agents, 0 human employees.*
