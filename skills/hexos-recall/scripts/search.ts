#!/usr/bin/env npx tsx
/**
 * Progressive Disclosure Memory Search
 * 
 * 3-layer approach for token efficiency:
 * 1. INDEX: titles + types + tags (~20 tokens/result)
 * 2. SUMMARY: adds summary paragraph (~80 tokens/result)
 * 3. FULL: includes details + files (~200+ tokens/result)
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { Observation, ObservationIndex, SearchResult, SearchResponse, DisclosureLevel } from './types.js';

const MEMORY_DIR = process.env.MEMORY_DIR || join(process.env.HOME!, 'clawd/memory');
const INDEX_PATH = join(MEMORY_DIR, 'observations.json');

// Approximate token counts per level
const TOKENS_PER_RESULT = {
  index: 25,
  summary: 80,
  full: 200
};

function loadIndex(): ObservationIndex {
  if (!existsSync(INDEX_PATH)) {
    console.error('No observation index found. Run compress.ts first.');
    process.exit(1);
  }
  return JSON.parse(readFileSync(INDEX_PATH, 'utf-8'));
}

function scoreMatch(obs: Observation, query: string): { score: number; matchedOn: string[] } {
  const terms = query.toLowerCase().split(/\s+/);
  let score = 0;
  const matchedOn: string[] = [];

  for (const term of terms) {
    // Title match (highest weight)
    if (obs.title.toLowerCase().includes(term)) {
      score += 10;
      matchedOn.push('title');
    }
    
    // Tag match (high weight)
    if (obs.tags.some(t => t.includes(term))) {
      score += 8;
      matchedOn.push('tags');
    }
    
    // Type match
    if (obs.type.includes(term)) {
      score += 5;
      matchedOn.push('type');
    }
    
    // Summary match
    if (obs.summary.toLowerCase().includes(term)) {
      score += 3;
      matchedOn.push('summary');
    }
    
    // File match
    if (obs.files?.some(f => f.toLowerCase().includes(term))) {
      score += 2;
      matchedOn.push('files');
    }
  }

  return { score, matchedOn: [...new Set(matchedOn)] };
}

function search(query: string, level: DisclosureLevel = 'index', limit = 10): SearchResponse {
  const index = loadIndex();
  
  // Score all observations
  const scored: SearchResult[] = index.observations
    .map(obs => {
      const { score, matchedOn } = scoreMatch(obs, query);
      return { observation: obs, score, matchedOn };
    })
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  // Calculate approximate tokens
  const totalTokens = scored.length * TOKENS_PER_RESULT[level];

  // Determine next level
  const nextLevel: DisclosureLevel | undefined = 
    level === 'index' ? 'summary' :
    level === 'summary' ? 'full' :
    undefined;

  return {
    level,
    query,
    results: scored,
    totalTokens,
    nextLevel
  };
}

function formatIndex(results: SearchResult[]): string {
  if (results.length === 0) return 'No matches found.';
  
  return results.map((r, i) => 
    `${i + 1}. [${r.observation.type}] ${r.observation.title} (${r.observation.tags.slice(0, 3).join(', ')})`
  ).join('\n');
}

function formatSummary(results: SearchResult[]): string {
  if (results.length === 0) return 'No matches found.';
  
  return results.map((r, i) => 
    `### ${i + 1}. ${r.observation.title}\n` +
    `**Type:** ${r.observation.type} | **Tags:** ${r.observation.tags.join(', ')}\n` +
    `${r.observation.summary}\n`
  ).join('\n');
}

function formatFull(results: SearchResult[]): string {
  if (results.length === 0) return 'No matches found.';
  
  return results.map((r, i) => {
    const obs = r.observation;
    let output = `### ${i + 1}. ${obs.title}\n`;
    output += `**ID:** ${obs.id}\n`;
    output += `**Type:** ${obs.type}\n`;
    output += `**Tags:** ${obs.tags.join(', ')}\n`;
    output += `**Source:** ${obs.source}\n`;
    output += `**Date:** ${obs.timestamp}\n\n`;
    output += `${obs.summary}\n`;
    if (obs.files && obs.files.length > 0) {
      output += `\n**Files:** ${obs.files.join(', ')}\n`;
    }
    if (obs.details) {
      output += `\n**Details:**\n${obs.details}\n`;
    }
    return output;
  }).join('\n---\n\n');
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log(`Usage: search.ts <query> [--level index|summary|full] [--limit N]`);
    console.log(`\nExamples:`);
    console.log(`  search.ts "podcast voices"`);
    console.log(`  search.ts "bugfix" --level summary`);
    console.log(`  search.ts "elevenlabs" --level full --limit 5`);
    process.exit(0);
  }

  // Parse args
  let query = '';
  let level: DisclosureLevel = 'index';
  let limit = 10;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--level' && args[i + 1]) {
      level = args[++i] as DisclosureLevel;
    } else if (args[i] === '--limit' && args[i + 1]) {
      limit = parseInt(args[++i], 10);
    } else if (!args[i].startsWith('--')) {
      query = args[i];
    }
  }

  if (!query) {
    console.error('Please provide a search query');
    process.exit(1);
  }

  const response = search(query, level, limit);

  console.log(`\n🔍 Search: "${query}" (level: ${level})`);
  console.log(`📊 Found: ${response.results.length} results (~${response.totalTokens} tokens)\n`);

  switch (level) {
    case 'index':
      console.log(formatIndex(response.results));
      break;
    case 'summary':
      console.log(formatSummary(response.results));
      break;
    case 'full':
      console.log(formatFull(response.results));
      break;
  }

  if (response.nextLevel) {
    console.log(`\n💡 For more detail, use --level ${response.nextLevel}`);
  }
}

main().catch(console.error);

// Export for programmatic use
export { search, formatIndex, formatSummary, formatFull };
