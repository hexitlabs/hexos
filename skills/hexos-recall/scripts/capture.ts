#!/usr/bin/env npx tsx
/**
 * Feedback Capture Script
 * 
 * Usage:
 *   npx tsx capture.ts correction --agent pixel --domain code-style \
 *     --context "Building dashboard component" \
 *     --trigger "User said 'always use Tailwind, not inline styles'" \
 *     --problem "Used inline styles" \
 *     --solution "Use Tailwind utility classes" \
 *     --pattern "Never use inline styles, always Tailwind" \
 *     --tags "css,tailwind,styling"
 * 
 *   npx tsx capture.ts success --agent node \
 *     --context "Built API endpoint" \
 *     --trigger "User praised the error handling" \
 *     --solution "Used custom error classes with consistent format" \
 *     --pattern "Always use custom error classes"
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { Feedback, FeedbackType, Domain, FeedbackStore } from './schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STORE_PATH = join(__dirname, '../../memory/feedback.json');

function loadStore(): FeedbackStore {
  if (!existsSync(STORE_PATH)) {
    return {
      version: '1.0.0',
      lastUpdated: new Date().toISOString(),
      entries: [],
      stats: {
        total: 0,
        byType: {} as Record<FeedbackType, number>,
        byAgent: {},
        appliedCount: 0
      }
    };
  }
  return JSON.parse(readFileSync(STORE_PATH, 'utf-8'));
}

function saveStore(store: FeedbackStore): void {
  store.lastUpdated = new Date().toISOString();
  writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

function generateId(): string {
  const now = new Date();
  const date = now.toISOString().split('T')[0];
  const store = loadStore();
  const todayCount = store.entries.filter(e => e.id.startsWith(date)).length;
  return `${date}-${String(todayCount + 1).padStart(4, '0')}`;
}

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const value = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : 'true';
      result[key] = value;
    }
  }
  return result;
}

function updateStats(store: FeedbackStore, entry: Feedback): void {
  store.stats.total++;
  store.stats.byType[entry.type] = (store.stats.byType[entry.type] || 0) + 1;
  if (entry.agent) {
    store.stats.byAgent[entry.agent] = (store.stats.byAgent[entry.agent] || 0) + 1;
  }
}

async function main() {
  const [,, type, ...rest] = process.argv;
  
  if (!type || type === '--help') {
    console.log(`
Usage: npx tsx capture.ts <type> [options]

Types: correction, error, success, preference, optimization

Options:
  --agent <name>      Agent that received feedback (pixel, node, forge, etc.)
  --severity <level>  critical, major, minor (default: minor)
  --domain <domain>   code-style, communication, tool-usage, workflow, etc.
  --context <text>    What was happening
  --trigger <text>    What triggered the feedback
  --problem <text>    What went wrong (for corrections/errors)
  --solution <text>   How it was fixed / what works
  --pattern <text>    Generalized pattern to apply
  --tags <csv>        Comma-separated tags

Example:
  npx tsx capture.ts correction --agent pixel --domain code-style \\
    --context "Building UI component" \\
    --trigger "User said use Tailwind not inline" \\
    --problem "Used inline styles" \\
    --solution "Switched to Tailwind classes" \\
    --pattern "Always use Tailwind, never inline styles" \\
    --tags "css,tailwind"
`);
    process.exit(0);
  }

  const validTypes: FeedbackType[] = ['correction', 'error', 'success', 'preference', 'optimization'];
  if (!validTypes.includes(type as FeedbackType)) {
    console.error(`Invalid type: ${type}. Must be one of: ${validTypes.join(', ')}`);
    process.exit(1);
  }

  const args = parseArgs(rest);
  
  const entry: Feedback = {
    id: generateId(),
    timestamp: new Date().toISOString(),
    type: type as FeedbackType,
    agent: args.agent,
    severity: (args.severity as Feedback['severity']) || 'minor',
    context: args.context || '',
    trigger: args.trigger || '',
    problem: args.problem,
    solution: args.solution,
    pattern: args.pattern,
    domain: (args.domain as Domain) || 'general',
    tags: args.tags ? args.tags.split(',').map(t => t.trim()) : [],
    applied: false
  };

  const store = loadStore();
  store.entries.push(entry);
  updateStats(store, entry);
  saveStore(store);

  console.log(`✅ Captured feedback: ${entry.id}`);
  console.log(JSON.stringify(entry, null, 2));
}

main().catch(console.error);
