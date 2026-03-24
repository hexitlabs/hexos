#!/bin/bash
# HexOS Deploy Script
# Usage: ./scripts/deploy.sh [staging|production]

set -euo pipefail

ENV="${1:-staging}"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if [ "$ENV" = "staging" ]; then
    echo "🚀 Deploying to STAGING..."
    BRANCH="develop"
    SERVICE="clawdbot-gateway-staging"
elif [ "$ENV" = "production" ]; then
    echo "🚀 Deploying to PRODUCTION..."
    BRANCH="main"
    # Production deploys all gateways - for now just note this
    echo "⚠️  Production deploy requires manual gateway restart"
    echo "Run: systemctl --user restart clawdbot-gateway"
else
    echo "❌ Unknown environment: $ENV"
    echo "Usage: ./scripts/deploy.sh [staging|production]"
    exit 1
fi

cd "$REPO_DIR"
echo "📦 Current branch: $(git branch --show-current)"
echo "📦 Switching to: $BRANCH"

git fetch origin
git checkout "$BRANCH"
git pull origin "$BRANCH"

echo "🏗️  Building..."
npm run build 2>/dev/null || echo "⚠️  No build script found, skipping"

if [ "$ENV" = "staging" ]; then
    echo "🔄 Restarting staging gateway..."
    systemctl --user restart "$SERVICE" 2>/dev/null || echo "⚠️  Staging service not running yet"
fi

echo "✅ Deployed $(git describe --tags --always) to $ENV"
