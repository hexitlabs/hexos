#!/usr/bin/env node
/**
 * Observations Index Generator
 * Creates a lightweight index for progressive disclosure memory retrieval
 */

import { readFile, writeFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

const MEMORY_DIR = '/root/clawd/memory';
const OBSERVATIONS_FILE = join(MEMORY_DIR, 'observations.json');
const INDEX_FILE = join(MEMORY_DIR, 'observations-index.json');

async function loadObservations() {
  if (!existsSync(OBSERVATIONS_FILE)) {
    return [];
  }
  const data = await readFile(OBSERVATIONS_FILE, 'utf-8');
  const parsed = JSON.parse(data);
  // Handle both wrapped and unwrapped formats
  return parsed.observations || parsed || [];
}

function extractKeywords(text) {
  // Simple keyword extraction
  const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should']);
  
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopWords.has(w))
    .slice(0, 10);
}

function createIndexEntry(obs) {
  const keywords = [
    ...extractKeywords(obs.title || ''),
    ...extractKeywords(obs.summary || ''),
    ...(obs.tags || [])
  ];
  
  return {
    id: obs.id,
    type: obs.type,
    title: obs.title,
    tags: [...new Set(obs.tags || [])],
    keywords: [...new Set(keywords)],
    timestamp: obs.timestamp,
    hasFiles: !!(obs.files && obs.files.length > 0),
    fileCount: obs.files?.length || 0
  };
}

async function generateIndex() {
  console.log('🔍 Loading observations...');
  const observations = await loadObservations();
  
  if (observations.length === 0) {
    console.log('No observations found.');
    return;
  }
  
  console.log(`Found ${observations.length} observations`);
  
  // Create index
  const index = observations.map(createIndexEntry);
  
  // Sort by timestamp (newest first)
  index.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  
  // Add metadata
  const indexWithMeta = {
    generatedAt: new Date().toISOString(),
    totalObservations: observations.length,
    typeBreakdown: index.reduce((acc, obs) => {
      acc[obs.type] = (acc[obs.type] || 0) + 1;
      return acc;
    }, {}),
    entries: index
  };
  
  // Write index
  await writeFile(INDEX_FILE, JSON.stringify(indexWithMeta, null, 2));
  
  console.log('✅ Index generated:');
  console.log(`  - Total entries: ${index.length}`);
  console.log(`  - Types: ${Object.entries(indexWithMeta.typeBreakdown).map(([k,v]) => `${k}: ${v}`).join(', ')}`);
  console.log(`  - Est. tokens (index only): ~${index.length * 25}`);
  console.log(`  - Saved to: ${INDEX_FILE}`);
}

// CLI
if (process.argv[2] === 'search') {
  const query = process.argv.slice(3).join(' ').toLowerCase();
  const index = JSON.parse(await readFile(INDEX_FILE, 'utf-8'));
  
  const matches = index.entries.filter(entry => 
    entry.title.toLowerCase().includes(query) ||
    entry.tags.some(t => t.toLowerCase().includes(query)) ||
    entry.keywords.some(k => k.toLowerCase().includes(query))
  );
  
  console.log(`\nFound ${matches.length} matches for "${query}":\n`);
  matches.slice(0, 10).forEach(m => {
    console.log(`  [${m.type}] ${m.title}`);
    console.log(`       Tags: ${m.tags.join(', ')} | ${m.timestamp.split('T')[0]}`);
  });
} else {
  generateIndex().catch(console.error);
}
