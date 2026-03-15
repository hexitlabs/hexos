# HexOS Recall

## What It Does
Long-term semantic memory for your AI assistant. Runs 100% locally using Ollama embeddings. No data leaves your server.

## Setup
Run the setup script to install Ollama, pull the embedding model, and create the memory file structure:

```bash
cd ~/your-workspace
bash skills/hexos-recall/scripts/setup.sh
```

## Memory Structure

Your workspace will have:
- `MEMORY.md` - long-term curated memories (key facts, preferences, decisions)
- `memory/YYYY-MM-DD.md` - daily structured logs (decisions, completions, corrections)
- `memory/lessons.md` - tracked mistakes and learnings
- `memory/preferences.md` - user preferences (auto-extracted)
- `memory/observations.json` - pattern index from daily interactions
- `memory/learning-queue.md` - topics for the AI to explore

## How Memory Works

### Automatic (built into HexOS)
- **Memory search** runs before answering questions about prior work, decisions, or preferences
- **Compaction memory flush** saves important context when conversations get long
- **Session transcripts** are searchable alongside memory files

### Maintenance Scripts (run periodically)

**Memory Decay** - keeps memories fresh by scoring relevance over time:
```bash
npx tsx scripts/memory-decay.ts update    # update scores
npx tsx scripts/memory-decay.ts status    # view current scores
```
Recommended: run twice weekly via cron.

**Observation Indexer** - extracts patterns from daily logs:
```bash
node scripts/observations-indexer.js       # index today
node scripts/observations-indexer.js --all # re-index everything
```
Recommended: run nightly via cron.

**Self-Improvement Synthesis** - analyzes mistakes and generates improvement proposals:
```bash
npx tsx scripts/synthesize.ts
```
Recommended: run weekly.

## HexOS Config

Add to your `hexos.json` under agent defaults:

```json
{
  "memorySearch": {
    "enabled": true,
    "sources": ["memory", "sessions"],
    "experimental": { "sessionMemory": true },
    "provider": "openai",
    "remote": {
      "baseUrl": "http://localhost:11434/v1/",
      "apiKey": "ollama"
    },
    "model": "nomic-embed-text"
  }
}
```

## Cron Integration

For automated maintenance, add these cron jobs:

```bash
# Memory decay (twice weekly, e.g. Wed + Sun)
0 22 * * 0,3  cd ~/your-workspace && npx tsx scripts/memory-decay.ts update

# Observation indexer (nightly)
0 22 * * *    cd ~/your-workspace && node scripts/observations-indexer.js

# Self-improvement synthesis (weekly, Sunday)
0 4 * * 0     cd ~/your-workspace && npx tsx scripts/synthesize.ts
```

Or use HexOS's built-in cron system for agent-managed scheduling.

## Daily Log Format

Each day, the AI should update `memory/YYYY-MM-DD.md` with:

```markdown
# YYYY-MM-DD

## Decisions
- [What was decided and why]

## Completions
- [What got done]

## Corrections
- [Mistakes, what to do differently]

## Active
- [Work in progress]

## Notes
- [Anything worth remembering]
```

## Privacy
- All embeddings computed locally via Ollama
- No external API calls for memory operations
- All data stored as plain markdown on your server
- Fully portable. Copy the files anywhere.

## Requirements
- Node.js 18+
- 4GB+ RAM (for Ollama)
- ~2GB disk (Ollama + nomic-embed-text model)
- Linux or macOS

## Built by HexIT Labs 🔷
