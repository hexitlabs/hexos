#!/bin/bash
# HexIT Recall — Setup Script
# Installs Ollama, pulls embedding model, creates memory structure

set -e

echo "🧠 HexIT Recall — Setup"
echo "========================"
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Detect workspace
WORKSPACE="${RECALL_WORKSPACE:-$(pwd)}"
echo -e "${YELLOW}Workspace:${NC} $WORKSPACE"
echo ""

# Step 1: Install Ollama
echo "Step 1/4: Checking Ollama..."
if command -v ollama &> /dev/null; then
    echo -e "  ${GREEN}✓${NC} Ollama already installed"
else
    echo "  Installing Ollama..."
    curl -fsSL https://ollama.com/install.sh | sh
    echo -e "  ${GREEN}✓${NC} Ollama installed"
fi

# Ensure Ollama is running
if ! curl -s http://localhost:11434/api/tags &> /dev/null; then
    echo "  Starting Ollama..."
    ollama serve &> /dev/null &
    sleep 3
fi
echo -e "  ${GREEN}✓${NC} Ollama running"

# Step 2: Pull embedding model
echo ""
echo "Step 2/4: Pulling embedding model..."
if ollama list 2>/dev/null | grep -q "nomic-embed-text"; then
    echo -e "  ${GREEN}✓${NC} nomic-embed-text already available"
else
    ollama pull nomic-embed-text
    echo -e "  ${GREEN}✓${NC} nomic-embed-text pulled"
fi

# Step 3: Create memory structure
echo ""
echo "Step 3/4: Creating memory structure..."

mkdir -p "$WORKSPACE/memory"

# MEMORY.md — long-term curated memories
if [ ! -f "$WORKSPACE/MEMORY.md" ]; then
    cat > "$WORKSPACE/MEMORY.md" << 'MEMEOF'
# MEMORY.md — Long-Term Memory

*Curated memories that persist across sessions. Updated automatically and manually.*

---

## Key Facts

- [Add important facts about the user, projects, preferences here]

## Preferences

- [Communication style, tool preferences, work habits]

## Key Decisions

- [Major decisions and their reasoning]

## People

- [Important contacts and relationships]

---

*Last updated: [date]*
MEMEOF
    echo -e "  ${GREEN}✓${NC} Created MEMORY.md"
else
    echo -e "  ${YELLOW}~${NC} MEMORY.md already exists, skipping"
fi

# Daily log template
TODAY=$(date +%Y-%m-%d)
if [ ! -f "$WORKSPACE/memory/$TODAY.md" ]; then
    cat > "$WORKSPACE/memory/$TODAY.md" << DAYEOF
# $TODAY

## Decisions
-

## Completions
-

## Corrections
-

## Active
-

## Notes
- HexIT Recall installed and configured
DAYEOF
    echo -e "  ${GREEN}✓${NC} Created today's daily log"
fi

# Lessons file
if [ ! -f "$WORKSPACE/memory/lessons.md" ]; then
    cat > "$WORKSPACE/memory/lessons.md" << 'LESSEOF'
# Lessons Learned

*Tracked mistakes and learnings to improve over time.*

## Stats
- Total mistakes: 0
- Total learnings: 0
- Last updated: [date]

## ❌ Mistakes

*None yet — learning starts now.*

## ✅ Learnings

*None yet — every interaction is a chance to learn.*
LESSEOF
    echo -e "  ${GREEN}✓${NC} Created memory/lessons.md"
fi

# Preferences file
if [ ! -f "$WORKSPACE/memory/preferences.md" ]; then
    cat > "$WORKSPACE/memory/preferences.md" << 'PREFEOF'
# User Preferences

*Extracted from interactions. Confidence increases with repetition.*

## Communication
- [Style preferences will be learned automatically]

## Work
- [Tool and workflow preferences]

## Schedule
- [Timezone, working hours, quiet hours]
PREFEOF
    echo -e "  ${GREEN}✓${NC} Created memory/preferences.md"
fi

# Learning queue
if [ ! -f "$WORKSPACE/memory/learning-queue.md" ]; then
    cat > "$WORKSPACE/memory/learning-queue.md" << 'LEARNEOF'
# Learning Queue

*Topics to explore during quiet time.*

## Queued
- [Topics will be added as gaps are identified]

## Completed
- [Finished topics move here]
LEARNEOF
    echo -e "  ${GREEN}✓${NC} Created memory/learning-queue.md"
fi

# Observations file
if [ ! -f "$WORKSPACE/memory/observations.json" ]; then
    echo '{"observations":[],"lastIndexed":null}' > "$WORKSPACE/memory/observations.json"
    echo -e "  ${GREEN}✓${NC} Created memory/observations.json"
fi

# Step 4: Verify
echo ""
echo "Step 4/4: Verifying installation..."

# Test Ollama embedding
RESULT=$(curl -s http://localhost:11434/api/embeddings -d '{"model":"nomic-embed-text","prompt":"test"}' | head -c 50)
if echo "$RESULT" | grep -q "embedding"; then
    echo -e "  ${GREEN}✓${NC} Embedding model working"
else
    echo -e "  ${RED}✗${NC} Embedding model test failed"
    echo "  Try: ollama pull nomic-embed-text"
fi

# Check files
FILE_COUNT=$(find "$WORKSPACE/memory" -type f | wc -l)
echo -e "  ${GREEN}✓${NC} Memory files created ($FILE_COUNT files)"

echo ""
echo "========================"
echo -e "${GREEN}🧠 HexIT Recall is ready!${NC}"
echo ""
echo "Memory structure: $WORKSPACE/memory/"
echo "Embedding model: nomic-embed-text (local)"
echo ""
echo "Next steps:"
echo "  1. Add to clawdbot.json (see README.md for config)"
echo "  2. Start building memories!"
echo ""
echo "Maintenance commands:"
echo "  npm run decay      — Update memory relevance scores"
echo "  npm run index      — Index observations from daily logs"
echo "  npm run synthesize — Run self-improvement analysis"
