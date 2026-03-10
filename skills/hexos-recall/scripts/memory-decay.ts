#!/usr/bin/env npx tsx
/**
 * Memory Decay Scoring System
 *
 * Calculates relevance scores for memory entries using exponential decay,
 * access frequency, and type weighting. Helps identify stale memories
 * for archival and surfaces the most relevant ones for queries.
 *
 * Formula: relevance(t) = base × e^(-0.03 × days_since_access) × log2(access_count + 1) × type_weight
 *
 * Usage:
 *   npx tsx memory-decay.ts update                    — recalculate all scores
 *   npx tsx memory-decay.ts query "search term"       — search with decay-weighted results
 *   npx tsx memory-decay.ts prune --threshold 0.05    — list entries below threshold
 *   npx tsx memory-decay.ts stats                     — show score distribution
 *   npx tsx memory-decay.ts --help                    — show this help
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'fs';
import { join, basename, relative } from 'path';

// ─── Constants ───────────────────────────────────────────────────────────────

const MEMORY_DIR = join(process.env.HOME || '/root', 'clawd', 'memory');
const DECAY_SCORES_PATH = join(MEMORY_DIR, 'decay-scores.json');
const DECAY_RATE = 0.03;

const TYPE_WEIGHTS: Record<EntryType, number> = {
  decision: 1.5,
  lesson: 1.3,
  preference: 1.2,
  completion: 0.8,
  note: 0.6,
  error: 1.4,
  correction: 1.3,
  observation: 1.0,
};

type EntryType = 'decision' | 'lesson' | 'preference' | 'completion' | 'note' | 'error' | 'correction' | 'observation';

interface DecayEntry {
  source: string;
  line: number;
  type: EntryType;
  title: string;
  firstSeen: string;
  lastAccessed: string;
  accessCount: number;
  baseScore: number;
  currentScore: number;
  tags: string[];
}

interface DecayStore {
  entries: Record<string, DecayEntry>;
  lastUpdated: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function loadStore(): DecayStore {
  if (existsSync(DECAY_SCORES_PATH)) {
    try {
      return JSON.parse(readFileSync(DECAY_SCORES_PATH, 'utf-8'));
    } catch {
      console.warn('⚠ Could not parse decay-scores.json, starting fresh');
    }
  }
  return { entries: {}, lastUpdated: new Date().toISOString() };
}

function saveStore(store: DecayStore): void {
  store.lastUpdated = new Date().toISOString();
  mkdirSync(MEMORY_DIR, { recursive: true });
  writeFileSync(DECAY_SCORES_PATH, JSON.stringify(store, null, 2));
}

function daysSince(isoDate: string): number {
  const diff = Date.now() - new Date(isoDate).getTime();
  return Math.max(0, diff / (1000 * 60 * 60 * 24));
}

function calcScore(entry: DecayEntry): number {
  const days = daysSince(entry.lastAccessed);
  const weight = TYPE_WEIGHTS[entry.type] ?? 1.0;
  return entry.baseScore * Math.exp(-DECAY_RATE * days) * Math.log2(entry.accessCount + 1) * weight;
}

function makeId(source: string, line: number, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  const src = basename(source, '.md').replace(/[^a-z0-9-]/gi, '');
  return `${src}-L${line}-${slug}`;
}

function extractDateFromSource(source: string): string {
  const m = source.match(/(\d{4}-\d{2}-\d{2})/);
  return m ? `${m[1]}T00:00:00Z` : new Date().toISOString();
}

// ─── Parsers ─────────────────────────────────────────────────────────────────

interface RawEntry {
  source: string;
  line: number;
  type: EntryType;
  title: string;
  tags: string[];
  baseScore: number;
}

/** Parse a daily log (memory/YYYY-MM-DD.md) */
function parseDailyLog(filePath: string): RawEntry[] {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const source = relative(join(MEMORY_DIR, '..'), filePath);
  const entries: RawEntry[] = [];
  let currentSection = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const sectionMatch = line.match(/^##\s+(.+)/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].toLowerCase().replace(/[^a-z]/g, '');
      continue;
    }

    // Decisions: "- **title**: description"
    if (currentSection === 'decisions' && line.match(/^-\s+\*\*(.+?)\*\*/)) {
      const title = line.match(/\*\*(.+?)\*\*/)?.[1] || line.slice(2).trim();
      entries.push({
        source, line: i + 1, type: 'decision',
        title: title.slice(0, 100),
        tags: extractInlineTags(line),
        baseScore: 1.0,
      });
    }

    // Completions: "- ✅ description"
    if (currentSection === 'completions' && line.match(/^-\s+✅/)) {
      const title = line.replace(/^-\s+✅\s*/, '').trim();
      entries.push({
        source, line: i + 1, type: 'completion',
        title: title.slice(0, 100),
        tags: extractInlineTags(line),
        baseScore: 0.8,
      });
    }

    // Notes: "- description"
    if (currentSection === 'notes' && line.match(/^-\s+\S/)) {
      const title = line.replace(/^-\s+/, '').trim();
      entries.push({
        source, line: i + 1, type: 'note',
        title: title.slice(0, 100),
        tags: extractInlineTags(line),
        baseScore: 0.7,
      });
    }
  }

  return entries;
}

/** Parse lessons.md */
function parseLessons(filePath: string): RawEntry[] {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const source = relative(join(MEMORY_DIR, '..'), filePath);
  const entries: RawEntry[] = [];
  let currentSection = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.match(/^##\s+❌\s+Mistakes/i)) { currentSection = 'mistakes'; continue; }
    if (line.match(/^##\s+✅\s+Learnings/i)) { currentSection = 'learnings'; continue; }
    if (line.match(/^##\s+🔄\s+Patterns/i)) { currentSection = 'patterns'; continue; }
    if (line.match(/^##\s+/)) { currentSection = ''; continue; }

    // Mistakes table rows: "| date | category | what | cause | prevention |"
    if (currentSection === 'mistakes' && line.match(/^\|\s*\d{4}-/)) {
      const cols = line.split('|').map(c => c.trim()).filter(Boolean);
      if (cols.length >= 3) {
        entries.push({
          source, line: i + 1, type: 'lesson',
          title: `[mistake] ${cols[2]?.slice(0, 80) || 'unknown'}`,
          tags: cols[1] ? [cols[1].toLowerCase()] : [],
          baseScore: 1.2,  // mistakes are valuable
        });
      }
    }

    // Learnings: "- **date**: insight"
    if (currentSection === 'learnings' && line.match(/^-\s+\*\*\d{4}/)) {
      const title = line.replace(/^-\s+\*\*[\d-]+\*\*:\s*/, '').trim();
      entries.push({
        source, line: i + 1, type: 'lesson',
        title: title.slice(0, 100),
        tags: extractInlineTags(line),
        baseScore: 1.0,
      });
    }

    // Inline lessons: "### ❌ Lesson:" or "### ✅ Lesson:" or "### 2026-..."
    if (line.match(/^###\s+(❌|✅)\s+(Lesson|Sent|Duplicate)/i)) {
      const title = line.replace(/^###\s+(❌|✅)\s*/, '').trim();
      entries.push({
        source, line: i + 1, type: 'lesson',
        title: title.slice(0, 100),
        tags: extractInlineTags(line),
        baseScore: 1.1,
      });
    }
  }

  return entries;
}

/** Parse observations.json */
function parseObservations(filePath: string): RawEntry[] {
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf-8'));
    const obs = data.observations || [];
    const source = relative(join(MEMORY_DIR, '..'), filePath);
    return obs.map((o: any, idx: number) => ({
      source,
      line: idx + 1,
      type: 'observation' as EntryType,
      title: (o.title || o.summary || 'untitled').slice(0, 100),
      tags: o.tags || [],
      baseScore: 0.9,
    }));
  } catch {
    return [];
  }
}

/** Parse preferences.md */
function parsePreferences(filePath: string): RawEntry[] {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const source = relative(join(MEMORY_DIR, '..'), filePath);
  const entries: RawEntry[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Entries like "- **preference**: detail" or "- text"
    if (line.match(/^-\s+\*\*.+\*\*/)) {
      const title = line.replace(/^-\s+/, '').replace(/\*\*/g, '').trim();
      entries.push({
        source, line: i + 1, type: 'preference',
        title: title.slice(0, 100),
        tags: extractInlineTags(line),
        baseScore: 1.0,
      });
    }
  }

  return entries;
}

function extractInlineTags(text: string): string[] {
  const tags: string[] = [];
  // Extract hashtag-style tags
  const hashTags = text.match(/#([a-z0-9_-]+)/gi);
  if (hashTags) tags.push(...hashTags.map(t => t.slice(1).toLowerCase()));
  // Extract backtick terms as tags
  const codeTags = text.match(/`([^`]+)`/g);
  if (codeTags) tags.push(...codeTags.map(t => t.replace(/`/g, '').toLowerCase()).slice(0, 3));
  return [...new Set(tags)];
}

// ─── Commands ────────────────────────────────────────────────────────────────

function cmdUpdate(): void {
  console.log('🔄 Scanning memory files...\n');
  const store = loadStore();
  const allRaw: RawEntry[] = [];

  // Scan daily logs
  const files = readdirSync(MEMORY_DIR);
  const dailyLogs = files.filter(f => f.match(/^\d{4}-\d{2}-\d{2}(-.+)?\.md$/));
  for (const f of dailyLogs) {
    const entries = parseDailyLog(join(MEMORY_DIR, f));
    allRaw.push(...entries);
  }
  console.log(`  📅 Daily logs: ${dailyLogs.length} files, ${allRaw.length} entries`);

  // Parse lessons.md
  const lessonsPath = join(MEMORY_DIR, 'lessons.md');
  if (existsSync(lessonsPath)) {
    const before = allRaw.length;
    allRaw.push(...parseLessons(lessonsPath));
    console.log(`  📚 Lessons: ${allRaw.length - before} entries`);
  }

  // Parse observations.json
  const obsPath = join(MEMORY_DIR, 'observations.json');
  if (existsSync(obsPath)) {
    const before = allRaw.length;
    allRaw.push(...parseObservations(obsPath));
    console.log(`  🔍 Observations: ${allRaw.length - before} entries`);
  }

  // Parse preferences.md
  const prefsPath = join(MEMORY_DIR, 'preferences.md');
  if (existsSync(prefsPath)) {
    const before = allRaw.length;
    allRaw.push(...parsePreferences(prefsPath));
    console.log(`  ⚙️  Preferences: ${allRaw.length - before} entries`);
  }

  // Parse learnings directory
  const learningsDir = join(MEMORY_DIR, 'learnings');
  if (existsSync(learningsDir)) {
    const lFiles = readdirSync(learningsDir).filter(f => f.endsWith('.md'));
    const before = allRaw.length;
    for (const f of lFiles) {
      const content = readFileSync(join(learningsDir, f), 'utf-8');
      const lines = content.split('\n');
      const source = relative(join(MEMORY_DIR, '..'), join(learningsDir, f));
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.match(/^##\s+\[ERR-/)) {
          const title = line.replace(/^##\s+/, '').trim();
          allRaw.push({ source, line: i + 1, type: 'error', title, tags: ['error'], baseScore: 1.2 });
        } else if (line.match(/^##\s+\[COR-/)) {
          const title = line.replace(/^##\s+/, '').trim();
          allRaw.push({ source, line: i + 1, type: 'correction', title, tags: ['correction'], baseScore: 1.1 });
        }
      }
    }
    if (allRaw.length > before) {
      console.log(`  🐛 Learnings: ${allRaw.length - before} entries`);
    }
  }

  // Merge into store, preserving access counts
  const now = new Date().toISOString();
  let newCount = 0;
  let updatedCount = 0;

  for (const raw of allRaw) {
    const id = makeId(raw.source, raw.line, raw.title);
    const existing = store.entries[id];

    if (existing) {
      // Update but preserve access metadata
      existing.title = raw.title;
      existing.type = raw.type;
      existing.tags = raw.tags;
      existing.baseScore = raw.baseScore;
      existing.currentScore = calcScore(existing);
      updatedCount++;
    } else {
      const sourceDate = extractDateFromSource(raw.source);
      store.entries[id] = {
        source: raw.source,
        line: raw.line,
        type: raw.type,
        title: raw.title,
        firstSeen: sourceDate,
        lastAccessed: sourceDate,
        accessCount: 1,
        baseScore: raw.baseScore,
        currentScore: 0,
        tags: raw.tags,
      };
      store.entries[id].currentScore = calcScore(store.entries[id]);
      newCount++;
    }
  }

  // Recalculate all scores
  for (const id of Object.keys(store.entries)) {
    store.entries[id].currentScore = calcScore(store.entries[id]);
  }

  saveStore(store);

  const total = Object.keys(store.entries).length;
  console.log(`\n✅ Update complete: ${total} total entries (${newCount} new, ${updatedCount} updated)`);

  // Show top 10
  const sorted = Object.entries(store.entries)
    .sort((a, b) => b[1].currentScore - a[1].currentScore)
    .slice(0, 10);

  console.log('\n📊 Top 10 by relevance:');
  for (const [id, entry] of sorted) {
    const typeIcon = { decision: '🎯', lesson: '📖', preference: '⚙️', completion: '✅', note: '📝', error: '🐛', correction: '🔧', observation: '🔍' }[entry.type] || '•';
    console.log(`  ${typeIcon} ${entry.currentScore.toFixed(3)} │ ${entry.type.padEnd(12)} │ ${entry.title.slice(0, 60)}`);
  }
}

function cmdQuery(searchTerm: string): void {
  const store = loadStore();
  const entries = Object.entries(store.entries);

  if (entries.length === 0) {
    console.log('No entries found. Run `npx tsx memory-decay.ts update` first.');
    return;
  }

  const term = searchTerm.toLowerCase();
  const results = entries
    .filter(([id, e]) =>
      e.title.toLowerCase().includes(term) ||
      e.tags.some(t => t.includes(term)) ||
      e.source.toLowerCase().includes(term) ||
      e.type.includes(term) ||
      id.toLowerCase().includes(term)
    )
    .sort((a, b) => b[1].currentScore - a[1].currentScore);

  if (results.length === 0) {
    console.log(`No results for "${searchTerm}".`);
    return;
  }

  // Bump access count for top results
  const now = new Date().toISOString();
  for (const [id] of results.slice(0, 5)) {
    store.entries[id].accessCount++;
    store.entries[id].lastAccessed = now;
    store.entries[id].currentScore = calcScore(store.entries[id]);
  }
  saveStore(store);

  console.log(`🔎 Found ${results.length} result(s) for "${searchTerm}":\n`);
  for (const [id, entry] of results.slice(0, 20)) {
    const days = daysSince(entry.lastAccessed).toFixed(0);
    console.log(`  ${entry.currentScore.toFixed(3)} │ ${entry.type.padEnd(12)} │ ${entry.title.slice(0, 55)}`);
    console.log(`         │ ${entry.source}:${entry.line}  │ ${days}d ago, ${entry.accessCount} accesses`);
  }
}

function cmdPrune(threshold: number): void {
  const store = loadStore();
  const entries = Object.entries(store.entries)
    .filter(([, e]) => e.currentScore < threshold)
    .sort((a, b) => a[1].currentScore - b[1].currentScore);

  if (entries.length === 0) {
    console.log(`✅ No entries below threshold ${threshold}. Memory is fresh!`);
    return;
  }

  console.log(`🗑️  ${entries.length} entries below threshold ${threshold} (candidates for archival):\n`);
  for (const [id, entry] of entries) {
    const days = daysSince(entry.lastAccessed).toFixed(0);
    console.log(`  ${entry.currentScore.toFixed(4)} │ ${entry.type.padEnd(12)} │ ${entry.title.slice(0, 55)}`);
    console.log(`          │ ${entry.source}:${entry.line}  │ ${days}d ago, ${entry.accessCount} accesses`);
  }

  console.log(`\nTo archive these, you can remove them from source files or mark as archived.`);
}

function cmdStats(): void {
  const store = loadStore();
  const entries = Object.values(store.entries);

  if (entries.length === 0) {
    console.log('No entries found. Run `npx tsx memory-decay.ts update` first.');
    return;
  }

  const scores = entries.map(e => e.currentScore).sort((a, b) => a - b);
  const sum = scores.reduce((a, b) => a + b, 0);
  const avg = sum / scores.length;
  const median = scores[Math.floor(scores.length / 2)];
  const min = scores[0];
  const max = scores[scores.length - 1];

  console.log('📊 Memory Decay Statistics\n');
  console.log(`  Total entries:    ${entries.length}`);
  console.log(`  Last updated:     ${store.lastUpdated}`);
  console.log(`  Score range:      ${min.toFixed(4)} — ${max.toFixed(4)}`);
  console.log(`  Average score:    ${avg.toFixed(4)}`);
  console.log(`  Median score:     ${median.toFixed(4)}`);

  // By type
  const byType: Record<string, { count: number; avgScore: number }> = {};
  for (const e of entries) {
    if (!byType[e.type]) byType[e.type] = { count: 0, avgScore: 0 };
    byType[e.type].count++;
    byType[e.type].avgScore += e.currentScore;
  }
  console.log('\n  By Type:');
  for (const [type, data] of Object.entries(byType).sort((a, b) => b[1].count - a[1].count)) {
    const weight = TYPE_WEIGHTS[type as EntryType] ?? 1.0;
    console.log(`    ${type.padEnd(14)} ${String(data.count).padStart(4)} entries  avg=${(data.avgScore / data.count).toFixed(3)}  weight=${weight}`);
  }

  // Distribution histogram
  const buckets = [0, 0.05, 0.1, 0.2, 0.5, 1.0, 2.0, Infinity];
  const hist: number[] = new Array(buckets.length - 1).fill(0);
  for (const s of scores) {
    for (let i = 0; i < buckets.length - 1; i++) {
      if (s >= buckets[i] && s < buckets[i + 1]) { hist[i]++; break; }
    }
  }

  console.log('\n  Score Distribution:');
  const maxBar = 40;
  const maxCount = Math.max(...hist);
  for (let i = 0; i < hist.length; i++) {
    const lo = buckets[i].toFixed(2);
    const hi = buckets[i + 1] === Infinity ? '∞' : buckets[i + 1].toFixed(2);
    const bar = '█'.repeat(Math.round((hist[i] / maxCount) * maxBar));
    const label = `[${lo}-${hi.padStart(4)})`;
    console.log(`    ${label.padEnd(14)} ${bar} ${hist[i]}`);
  }

  // Staleness
  const stale30 = entries.filter(e => daysSince(e.lastAccessed) > 30).length;
  const stale7 = entries.filter(e => daysSince(e.lastAccessed) > 7).length;
  const fresh = entries.filter(e => daysSince(e.lastAccessed) <= 1).length;

  console.log('\n  Freshness:');
  console.log(`    Fresh (≤1d):     ${fresh}`);
  console.log(`    Stale (>7d):     ${stale7}`);
  console.log(`    Very stale (>30d): ${stale30}`);

  // Top tags
  const tagCounts: Record<string, number> = {};
  for (const e of entries) {
    for (const t of e.tags) {
      tagCounts[t] = (tagCounts[t] || 0) + 1;
    }
  }
  const topTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (topTags.length > 0) {
    console.log('\n  Top Tags:');
    for (const [tag, count] of topTags) {
      console.log(`    ${tag.padEnd(20)} ${count}`);
    }
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

function showHelp(): void {
  console.log(`
Memory Decay Scoring System
━━━━━━━━━━━━━━━━━━━━━━━━━━

Tracks and scores memory entries using exponential decay. Entries that
are accessed more often and more recently score higher.

Formula: relevance = base × e^(-0.03 × days) × log₂(accesses + 1) × type_weight

Type weights:
  decision=1.5  lesson=1.3  preference=1.2  error=1.4  correction=1.3
  observation=1.0  completion=0.8  note=0.6

Commands:
  update                       Scan all memory files and recalculate scores
  query <term>                 Search entries (boosts access count of results)
  prune [--threshold N]        List entries below score threshold (default: 0.05)
  stats                        Show score distribution and statistics

Options:
  --threshold <number>         Score threshold for prune (default: 0.05)
  --help, -h                   Show this help

Examples:
  npx tsx memory-decay.ts update
  npx tsx memory-decay.ts query "viper"
  npx tsx memory-decay.ts query "docker"
  npx tsx memory-decay.ts prune --threshold 0.1
  npx tsx memory-decay.ts stats

Data stored in: ~/clawd/memory/decay-scores.json
`);
}

function main(): void {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    showHelp();
    process.exit(0);
  }

  switch (command) {
    case 'update':
      cmdUpdate();
      break;
    case 'query': {
      const term = args[1];
      if (!term) {
        console.error('Usage: npx tsx memory-decay.ts query "search term"');
        process.exit(1);
      }
      cmdQuery(term);
      break;
    }
    case 'prune': {
      let threshold = 0.05;
      const threshIdx = args.indexOf('--threshold');
      if (threshIdx !== -1 && args[threshIdx + 1]) {
        threshold = parseFloat(args[threshIdx + 1]);
        if (isNaN(threshold)) {
          console.error('Invalid threshold value');
          process.exit(1);
        }
      }
      cmdPrune(threshold);
      break;
    }
    case 'stats':
      cmdStats();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      showHelp();
      process.exit(1);
  }
}

main();
