#!/usr/bin/env npx tsx
/**
 * Weekly Synthesis Job
 * 
 * Processes accumulated feedback and generates improvement proposals.
 * Run via cron or manually: npx tsx synthesize.ts
 * 
 * Output: Markdown report + JSON proposals for review
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { Feedback, FeedbackStore, ProposedChange } from './schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STORE_PATH = join(__dirname, '../../memory/feedback.json');
const PROPOSALS_PATH = join(__dirname, '../../memory/improvement-proposals.json');
const REPORT_PATH = join(__dirname, '../../memory/synthesis-reports');

interface Proposal {
  id: string;
  createdAt: string;
  status: 'pending' | 'approved' | 'rejected' | 'applied';
  feedbackIds: string[];
  change: ProposedChange;
  reasoning: string;
}

interface ProposalStore {
  version: string;
  lastSynthesis: string;
  proposals: Proposal[];
}

function loadStore(): FeedbackStore {
  if (!existsSync(STORE_PATH)) {
    console.log('No feedback store found');
    process.exit(0);
  }
  return JSON.parse(readFileSync(STORE_PATH, 'utf-8'));
}

function loadProposals(): ProposalStore {
  if (!existsSync(PROPOSALS_PATH)) {
    return {
      version: '1.0.0',
      lastSynthesis: '',
      proposals: []
    };
  }
  return JSON.parse(readFileSync(PROPOSALS_PATH, 'utf-8'));
}

function saveProposals(store: ProposalStore): void {
  writeFileSync(PROPOSALS_PATH, JSON.stringify(store, null, 2));
}

function getUnprocessedFeedback(store: FeedbackStore, lastSynthesis: string): Feedback[] {
  if (!lastSynthesis) return store.entries.filter(e => !e.applied);
  const lastDate = new Date(lastSynthesis);
  return store.entries.filter(e => 
    new Date(e.timestamp) > lastDate && !e.applied
  );
}

function groupByPattern(entries: Feedback[]): Map<string, Feedback[]> {
  const groups = new Map<string, Feedback[]>();
  
  for (const entry of entries) {
    // Group by domain + agent combo
    const key = `${entry.domain}:${entry.agent || 'all'}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(entry);
  }
  
  return groups;
}

function generateProposal(group: Feedback[], key: string): Proposal | null {
  if (group.length < 2) return null; // Need at least 2 similar issues to propose a change
  
  const [domain, agent] = key.split(':');
  const patterns = group.filter(e => e.pattern).map(e => e.pattern!);
  const solutions = group.filter(e => e.solution).map(e => e.solution!);
  
  if (patterns.length === 0 && solutions.length === 0) return null;
  
  const proposal: Proposal = {
    id: `prop-${Date.now()}`,
    createdAt: new Date().toISOString(),
    status: 'pending',
    feedbackIds: group.map(e => e.id),
    change: {
      target: 'soul',
      agent: agent !== 'all' ? agent : undefined,
      file: agent !== 'all' ? `agents/${agent}/SOUL.md` : 'SOUL.md',
      description: `Add guidance based on ${group.length} feedback items:\n${patterns.concat(solutions).slice(0, 3).join('\n')}`,
      confidence: group.length >= 3 ? 'high' : 'medium',
      autoApply: false
    },
    reasoning: `Found ${group.length} related items in domain "${domain}" for ${agent === 'all' ? 'all agents' : agent}`
  };
  
  return proposal;
}

function generateReport(
  feedback: Feedback[], 
  proposals: Proposal[], 
  stats: FeedbackStore['stats']
): string {
  const now = new Date().toISOString();
  const date = now.split('T')[0];
  
  return `# Synthesis Report - ${date}

## Summary

- **Total feedback processed:** ${feedback.length}
- **New proposals generated:** ${proposals.length}
- **Cumulative stats:** ${stats.total} total, ${stats.appliedCount} applied

## Feedback by Type

${Object.entries(stats.byType).map(([type, count]) => `- ${type}: ${count}`).join('\n')}

## Feedback by Agent

${Object.entries(stats.byAgent).map(([agent, count]) => `- ${agent}: ${count}`).join('\n')}

## New Proposals

${proposals.length === 0 ? '_No new proposals generated_' : proposals.map(p => `
### ${p.id}

**Target:** ${p.change.file}
**Confidence:** ${p.change.confidence}
**Based on:** ${p.feedbackIds.length} feedback items

${p.change.description}

**Reasoning:** ${p.reasoning}
`).join('\n')}

## Recent Feedback

${feedback.slice(-10).map(f => `
- **[${f.id}]** ${f.type} (${f.domain})
  - Context: ${f.context || '_none_'}
  - Pattern: ${f.pattern || f.solution || '_none_'}
`).join('\n')}

---
Generated: ${now}
`;
}

async function main() {
  console.log('🔄 Running synthesis...\n');
  
  const feedbackStore = loadStore();
  const proposalStore = loadProposals();
  
  const unprocessed = getUnprocessedFeedback(feedbackStore, proposalStore.lastSynthesis);
  console.log(`Found ${unprocessed.length} unprocessed feedback items`);
  
  if (unprocessed.length === 0) {
    console.log('Nothing to synthesize');
    return;
  }
  
  // Group by domain+agent and generate proposals
  const groups = groupByPattern(unprocessed);
  const newProposals: Proposal[] = [];
  
  for (const [key, group] of groups) {
    const proposal = generateProposal(group, key);
    if (proposal) {
      newProposals.push(proposal);
      proposalStore.proposals.push(proposal);
    }
  }
  
  console.log(`Generated ${newProposals.length} new proposals`);
  
  // Update synthesis timestamp
  proposalStore.lastSynthesis = new Date().toISOString();
  saveProposals(proposalStore);
  
  // Generate and save report
  const report = generateReport(unprocessed, newProposals, feedbackStore.stats);
  const reportPath = join(REPORT_PATH, `${new Date().toISOString().split('T')[0]}.md`);
  
  // Ensure report directory exists
  const { mkdirSync } = await import('fs');
  mkdirSync(REPORT_PATH, { recursive: true });
  writeFileSync(reportPath, report);
  
  console.log(`\n📊 Report saved to: ${reportPath}`);
  console.log('\n' + report);
}

main().catch(console.error);
