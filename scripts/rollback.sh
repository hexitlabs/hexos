#!/bin/bash
# HexOS Rollback Script
# Usage: ./scripts/rollback.sh <version>
# Example: ./scripts/rollback.sh v0.1.1

set -euo pipefail

VERSION="${1:-}"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if [ -z "$VERSION" ]; then
    echo "❌ No version specified"
    echo "Usage: ./scripts/rollback.sh <version>"
    echo ""
    echo "Available versions:"
    cd "$REPO_DIR" && git tag --sort=-version:refname | head -5
    exit 1
fi

cd "$REPO_DIR"

# Verify tag exists
if ! git rev-parse "$VERSION" >/dev/null 2>&1; then
    echo "❌ Version $VERSION not found"
    echo "Available versions:"
    git tag --sort=-version:refname | head -5
    exit 1
fi

echo "⏪ Rolling back to $VERSION..."
echo "Current: $(git describe --tags --always)"

git checkout main
git reset --hard "$VERSION"
git push origin main --force-with-lease

echo "✅ Rolled back to $VERSION"
echo "⚠️  Restart gateways to apply: systemctl --user restart clawdbot-gateway"
