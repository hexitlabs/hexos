# Getting Started with HexOS

## Prerequisites

- Node.js 18 or later
- An API key (Anthropic, OpenAI, or compatible)
- A server or local machine

## Installation

### Option 1: npm (recommended)

```bash
npm install -g @hexitlabs/hexos
```

### Option 2: From source

```bash
git clone https://github.com/hexitlabs/hexos.git
cd hexos
npm link
```

## Setup

Run the interactive setup wizard:

```bash
hexos setup
```

This creates your workspace with:

- `SOUL.md` — Your agent's personality
- `USER.md` — Info about you
- `AGENTS.md` — Agent configuration
- `HEARTBEAT.md` — Periodic check-in rules
- `hexos.json` — Main configuration
- `memory/` — Persistent memory storage

## Configuration

Edit `hexos.json` to configure:

- Model provider and API key
- Channel connections (Telegram, Discord, etc.)
- Heartbeat interval
- Vigil safety policy

## Running

Start the gateway:

```bash
hexos gateway start
```

Check status:

```bash
hexos status
```

Run health checks:

```bash
hexos doctor
```

## Next Steps

- Configure a [channel](../channels/README.md) (Telegram, Discord, etc.)
- Add [skills](../skills/README.md) for specialized capabilities
- Set up [agents](../agents/README.md) for multi-agent workflows
