# HexOS

**The OS for AI-powered businesses.**

[![npm version](https://img.shields.io/npm/v/@hexitlabs/hexos)](https://www.npmjs.com/package/@hexitlabs/hexos)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/hexitlabs/hexos)](https://github.com/hexitlabs/hexos)

---

## What is HexOS?

Deploy AI agent teams that work 24/7. Multi-channel support for Telegram, Discord, Slack, WhatsApp, Signal, and more. Persistent memory, safety guardrails, 55+ skills, and full self-hosting. One CLI to run your entire AI workforce.

## Quick Start

```bash
npm install -g @hexitlabs/hexos
hexos setup
hexos gateway start
```

That's it. Your agent is live on Telegram.

Run `hexos doctor` to verify everything is working.

---

## Features

- 🤖 **Multi-agent orchestration** - Deploy specialized agents that coordinate and collaborate
- 🧠 **Persistent memory (Recall)** - Agents remember context across sessions and conversations
- 💬 **6+ messaging channels** - Telegram, Discord, Slack, WhatsApp, Signal, CLI, and more
- 🛡️ **Safety guardrails (Vigil)** - Built-in action validation before anything dangerous runs
- 🔧 **55+ built-in skills** - Web search, email, calendar, browser automation, TTS, cameras, and more
- 📱 **Profile agents (multi-gateway)** - Run multiple agents with different personalities on one server
- 🐼 **Built-in headless browser (Lightpanda)** - Browse the web, scrape pages, automate workflows
- ⚡ **/effort command** - Control thinking depth on the fly (quick answers vs deep reasoning)
- 🔒 **Server security (hexos secure)** - One command to harden your server with firewall, SSH, and fail2ban
- 📅 **Scheduling** - Heartbeats, cron jobs, and event-driven triggers
- 🔌 **Plugin SDK** - Build and share custom skills and integrations

---

## Agent Templates

HexOS ships with 6 ready-to-use agent templates. Each one includes a full SOUL.md personality, workflows, and operating frameworks.

| Template | Description |
|----------|-------------|
| **CEO / Business Partner** | Strategic co-founder that manages operations, tracks decisions, and thinks ahead |
| **Research Assistant** | Deep research analyst that verifies claims, cross-references sources, and synthesizes findings |
| **Content Writer** | Sharp writer that matches any voice, edits ruthlessly, and delivers publish-ready content |
| **Code Assistant** | Senior developer that writes production-ready code with tests and proper error handling |
| **Trading Analyst** | Data-driven market analyst with structured bull/bear frameworks and risk assessment |
| **Customer Support** | Patient, solution-oriented support agent that turns frustrated users into advocates |

Start with a template:

```bash
hexos setup --template ceo
```

Or build your own agent from scratch by writing a custom SOUL.md.

---

## How HexIT Labs Uses It

HexIT Labs runs its entire company on HexOS. 1 founder, 38 AI agents, 2 servers. Research, content, trading, development, security auditing, sales. All automated.

HexOS is not a demo. It is not a proof of concept. It is how we work every day.

---

## Supported Channels

- 💬 **Telegram** - Full support with inline buttons, reactions, voice messages
- 🎮 **Discord** - Servers, DMs, threads, reactions, voice
- 💼 **Slack** - Workspaces, channels, threads
- 📱 **WhatsApp** - Personal and business accounts
- 🔒 **Signal** - Privacy-first encrypted messaging
- 🖥️ **CLI** - Local terminal interface for development and testing
- 🌐 **Web** - Browser-based chat interface

---

## Architecture

```
hexos
├── Gateway          # Message routing and channel adapters
├── Agents           # AI agent runtime with SOUL.md personalities
├── Skills           # 55+ built-in capabilities (search, email, browser, etc.)
├── Recall           # Persistent memory and context management
├── Vigil            # Safety guardrails and action validation
├── Profiles         # Multi-agent configuration and orchestration
├── Scheduler        # Cron jobs, heartbeats, event triggers
└── Plugin SDK       # Build custom skills and integrations
```

---

## CLI Reference

```bash
hexos setup              # Interactive first-time setup
hexos gateway start      # Start the gateway daemon
hexos gateway stop       # Stop the gateway
hexos gateway restart    # Restart the gateway
hexos gateway status     # Check gateway health
hexos doctor             # Diagnose common issues
hexos secure             # Harden your server (firewall, SSH, fail2ban)
hexos update             # Update to the latest version
hexos profile list       # List configured agent profiles
hexos profile add        # Add a new agent profile
```

---

## Documentation

Full docs available at [hexos.dev](https://hexos.dev) (coming soon).

- [Getting Started](docs/getting-started.md)
- [Configuration](docs/config/README.md)
- [Agent Guide](docs/agents/README.md)
- [Skills Reference](docs/skills/README.md)
- [Channel Setup](docs/channels/)
- [Plugin SDK](docs/plugins/)

---

## Community

- [GitHub Discussions](https://github.com/hexitlabs/hexos/discussions) - Questions, ideas, show and tell
- [Discord](https://discord.gg/hexos) - Real-time chat with the community
- [Twitter / X](https://x.com/hexitlabs) - Updates and announcements

---

## Requirements

- Node.js 22+
- A supported AI provider API key (Anthropic, OpenAI, Google, etc.)
- A messaging platform bot token (Telegram, Discord, etc.)
- Linux VPS recommended for production (Ubuntu 22.04+)

---

## Contributing

Contributions welcome. Check [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

```bash
git clone https://github.com/hexitlabs/hexos.git
cd hexos
npm install
npm run build
```

---

## License & Credits

[MIT](LICENSE)

HexOS is built on [Clawdbot](https://github.com/openclaw/openclaw) (now OpenClaw) by [Peter Steinberger](https://github.com/steipete), which itself adapts portions of [Pi](https://github.com/earendil-works/pi-mono) by Mario Zechner. Both MIT licensed — see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

---

Built by [HexIT Labs](https://hexitlabs.com) 🔷
