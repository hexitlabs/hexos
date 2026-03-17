# Getting Started with HexOS

This guide walks you through installing HexOS, setting up your first agent, and going live on a messaging platform in under 10 minutes.

---

## Prerequisites

Before you begin, make sure you have:

- **Node.js 22+** installed ([download](https://nodejs.org/))
- **An AI provider API key** (Anthropic Claude recommended, but OpenAI and Google also work)
- **A messaging platform bot token** (we will use Telegram in this guide)

---

## Step 1: Install HexOS

Install HexOS globally via npm:

```bash
npm install -g @hexitlabs/hexos
```

Verify the installation:

```bash
hexos --version
```

You should see the current version number printed to your terminal.

<!-- Screenshot: terminal showing `hexos --version` output -->

---

## Step 2: Run Setup

The interactive setup wizard configures everything you need:

```bash
hexos setup
```

This will walk you through:

1. **AI Provider** - Select your provider and enter your API key
2. **Default Model** - Choose which model your agent will use
3. **Messaging Channel** - Pick a platform (Telegram, Discord, Slack, etc.)
4. **Bot Token** - Enter the token for your messaging bot
5. **Agent Name** - Give your agent an identity

<!-- Screenshot: terminal showing the hexos setup wizard -->

### Choosing a Template (Optional)

If you want to start with a pre-built agent personality:

```bash
hexos setup --template ceo
```

Available templates:
- `ceo` - Strategic business partner and operations manager
- `researcher` - Deep research analyst with verification frameworks
- `writer` - Content writer with editorial standards
- `coder` - Senior developer with code review practices
- `trader` - Financial analyst with structured market analysis
- `support` - Customer support agent with escalation protocols

---

## Step 3: Start the Gateway

Launch the HexOS gateway daemon:

```bash
hexos gateway start
```

The gateway handles all message routing between your AI provider and your messaging channels.

<!-- Screenshot: terminal showing gateway start output with "Gateway started" confirmation -->

Check that everything is running:

```bash
hexos gateway status
```

---

## Step 4: Talk to Your Agent

Open your messaging platform and send a message to your bot. It should respond immediately.

Try these first messages:

- "Hello, who are you?"
- "What can you do?"
- "Search the web for the latest news about AI"

<!-- Screenshot: Telegram conversation showing first interaction with the agent -->

Congratulations. Your agent is live.

---

## Step 5: Health Check

Run the built-in diagnostics to make sure everything is configured properly:

```bash
hexos doctor
```

This checks:
- Node.js version compatibility
- API key validity
- Gateway connectivity
- Channel configuration
- Installed skill dependencies

<!-- Screenshot: terminal showing hexos doctor output with all checks passing -->

---

## Understanding Your Workspace

After setup, HexOS creates a workspace directory with this structure:

```
~/hexos/          (or your configured workspace)
├── SOUL.md       # Your agent's personality and behavior rules
├── USER.md       # Information about you (the human)
├── MEMORY.md     # Agent's long-term curated memory
├── TOOLS.md      # Local tool configuration notes
├── AGENTS.md     # Workspace operating rules
├── memory/       # Daily memory files (YYYY-MM-DD.md)
└── skills/       # Custom skill configurations
```

### Key Files

**SOUL.md** - This is the most important file. It defines who your agent is, how it thinks, and how it behaves. Edit this to customize your agent's personality, workflows, and operating style.

**USER.md** - Tell your agent about yourself. Your name, preferences, work context, communication style. The more it knows, the better it serves you.

**MEMORY.md** - Your agent's long-term memory. It reads this at the start of every session to maintain continuity. The agent updates it automatically, but you can edit it too.

---

## Common Next Steps

### Add More Channels

Your agent can run on multiple platforms simultaneously. Add a new channel:

```bash
hexos channel add discord
```

Follow the prompts to enter your Discord bot token and server configuration.

### Add a Second Agent

Run multiple agents with different roles on the same server:

```bash
hexos profile add --template researcher
```

Each profile gets its own SOUL.md, memory, and channel configuration.

### Set Up Scheduling

Enable heartbeats so your agent checks in periodically:

Edit your agent configuration to enable heartbeats with a cron schedule. Your agent will wake up, check for pending tasks, and proactively reach out when something needs attention.

### Secure Your Server

If you are running HexOS on a public VPS, harden your server:

```bash
hexos secure
```

This sets up:
- UFW firewall with sensible defaults
- SSH key-only authentication
- fail2ban for brute-force protection
- Automatic security updates

<!-- Screenshot: terminal showing hexos secure output -->

---

## Controlling Thinking Depth

Use the `/effort` command in chat to control how deeply your agent thinks:

- `/effort low` - Quick, concise responses (good for simple questions)
- `/effort medium` - Balanced thinking (default)
- `/effort high` - Deep reasoning with extended thinking (complex problems)

This maps directly to the AI provider's thinking/reasoning capabilities.

---

## Useful CLI Commands

| Command | Description |
|---------|-------------|
| `hexos setup` | Interactive first-time setup |
| `hexos gateway start` | Start the gateway daemon |
| `hexos gateway stop` | Stop the gateway |
| `hexos gateway restart` | Restart after config changes |
| `hexos gateway status` | Check gateway health |
| `hexos doctor` | Run diagnostics |
| `hexos secure` | Harden your server |
| `hexos update` | Update to latest version |
| `hexos profile list` | List all agent profiles |
| `hexos profile add` | Add a new agent profile |
| `hexos channel add` | Add a messaging channel |
| `hexos logs` | View gateway logs |

---

## Troubleshooting

### Agent not responding

1. Check the gateway is running: `hexos gateway status`
2. Run diagnostics: `hexos doctor`
3. Check logs: `hexos logs`
4. Verify your API key is valid and has credits
5. Restart the gateway: `hexos gateway restart`

### Slow responses

- Check your AI provider's status page for outages
- Try `/effort low` for faster responses
- Ensure your server has sufficient resources (2GB RAM minimum recommended)

### Setup wizard errors

- Make sure Node.js 22+ is installed: `node --version`
- Try running with verbose logging: `HEXOS_DEBUG=1 hexos setup`
- Check that your bot token is correct (common issue: extra whitespace)

---

## Next Steps

- Read the full [documentation](https://hexos.dev)
- Browse the [Skills Reference](skills/) to see what your agent can do
- Join the [Discord community](https://discord.gg/hexos) for help and ideas
- Check out [Agent Templates](../templates/agents/) for inspiration on SOUL.md writing

---

Built by [HexIT Labs](https://hexitlabs.com) 🔷
