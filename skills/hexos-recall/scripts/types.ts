// Observation types inspired by claude-mem
export type ObservationType = 
  | 'bugfix'      // Fixed a bug
  | 'feature'     // Implemented something new
  | 'learning'    // Learned something useful
  | 'decision'    // Made an architectural/design decision
  | 'preference'  // User preference captured
  | 'todo'        // Task to do later
  | 'config'      // Configuration change
  | 'research'    // Research findings
  | 'tool'        // Tool/workflow discovery

export interface Observation {
  id: string;
  type: ObservationType;
  title: string;           // Short title (~10 words)
  summary: string;         // One paragraph summary
  details?: string;        // Full details (lazy loaded)
  tags: string[];          // Searchable tags
  files?: string[];        // Related files
  timestamp: string;       // ISO date
  source: string;          // Source file (e.g., memory/2026-02-02.md)
}

export interface ObservationIndex {
  version: number;
  lastUpdated: string;
  observations: Observation[];
}

// Progressive disclosure levels
export type DisclosureLevel = 'index' | 'summary' | 'full';

export interface SearchResult {
  observation: Observation;
  score: number;
  matchedOn: string[];
}

export interface SearchResponse {
  level: DisclosureLevel;
  query: string;
  results: SearchResult[];
  totalTokens: number;
  nextLevel?: DisclosureLevel;
}
