/**
 * Agent Self-Improvement System - Feedback Schema
 * 
 * Machine-readable format for capturing corrections, learnings, and patterns
 * that can be processed by the weekly synthesis job.
 */

export interface Feedback {
  id: string;                    // YYYY-MM-DD-NNNN
  timestamp: string;             // ISO 8601
  type: FeedbackType;
  agent?: string;                // Which agent (if applicable)
  severity: 'critical' | 'major' | 'minor';
  
  // What happened
  context: string;               // Brief context of the situation
  trigger: string;               // What triggered the feedback (user correction, error, etc.)
  
  // The learning
  problem?: string;              // What went wrong (for corrections)
  solution?: string;             // How it was fixed / what works
  pattern?: string;              // Generalized pattern to apply
  
  // Categorization
  domain: Domain;
  tags: string[];
  
  // For synthesis
  proposedChange?: ProposedChange;
  applied: boolean;
  appliedAt?: string;
}

export type FeedbackType = 
  | 'correction'      // User corrected agent behavior
  | 'error'           // Something failed/broke
  | 'success'         // Something worked well (positive pattern)
  | 'preference'      // User preference discovered
  | 'optimization';   // Found a better way

export type Domain =
  | 'code-style'
  | 'communication'
  | 'tool-usage'
  | 'workflow'
  | 'architecture'
  | 'security'
  | 'performance'
  | 'ux'
  | 'general';

export interface ProposedChange {
  target: 'soul' | 'patterns' | 'tools' | 'workflow' | 'config';
  agent?: string;                // Specific agent, or undefined for all
  file: string;                  // File to update
  description: string;           // What to change
  confidence: 'high' | 'medium' | 'low';
  autoApply: boolean;            // Can be auto-applied without approval
}

export interface FeedbackStore {
  version: string;
  lastUpdated: string;
  entries: Feedback[];
  stats: {
    total: number;
    byType: Record<FeedbackType, number>;
    byAgent: Record<string, number>;
    appliedCount: number;
  };
}
