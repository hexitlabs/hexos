#!/bin/bash
# HexOS Release Script
# Usage: ./scripts/release.sh <version> [message]
# Example: ./scripts/release.sh v0.2.0 "Phase 1: Workspace Jail"

set -euo pipefail

VERSION="${1:-}"
MESSAGE="${2:-Release $VERSION}"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if [ -z "$VERSION" ]; then
    echo "❌ No version specified"
    echo "Usage: ./scripts/release.sh <version> [message]"
    echo "Example: ./scripts/release.sh v0.2.0 \"Phase 1: Workspace Jail\""
    exit 1
fi

cd "$REPO_DIR"

# Must be on main
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "main" ]; then
    echo "❌ Must be on main branch (currently on: $CURRENT_BRANCH)"
    exit 1
fi

# Tag and push
echo "🏷️  Tagging $VERSION: $MESSAGE"
git tag -a "$VERSION" -m "$MESSAGE"
git push origin "$VERSION"

# Generate changelog entry
echo ""
echo "📝 Changelog entry:"
echo "## $VERSION ($(date +%Y-%m-%d))"
echo ""
PREV_TAG=$(git tag --sort=-version:refname | sed -n '2p')
if [ -n "$PREV_TAG" ]; then
    git log --oneline "$PREV_TAG"..HEAD | sed 's/^/- /'
else
    git log --oneline | head -10 | sed 's/^/- /'
fi

echo ""
echo "✅ Released $VERSION"
