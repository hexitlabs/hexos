/**
 * HexOS Capability System — Phase 1 + Phase 2 + Phase 3 (v0.8.0)
 *
 * Central export for the deployment profile / capability system.
 */

// Phase 1
export { CAPABILITY_KEYS, STRUCTURED_CAPABILITY_KEYS, ARRAY_CAPABILITY_KEYS } from './types.js';
export { PROFILES, PROFILE_NAMES, SOVEREIGN, OPERATOR, MANAGED } from './presets.js';
export { CapabilityDeniedError, CAPABILITY_FIX_HINTS, formatDenialMessage } from './errors.js';
export {
  initCapabilities,
  getCapability,
  requireCapability,
  getResolvedProfile,
  getResolvedCapabilities,
  resetCapabilities,
  validateOverrides,
  deepMerge,
} from './resolver.js';

// Phase 2
export {
  categorizeAction,
  checkApproval,
  ApprovalRequiredError,
  EXTERNAL_ACTIONS,
  DESTRUCTIVE_ACTIONS,
  drainAuditEvents,
} from './approval.js';

export {
  InMemoryCostProvider,
  CostLimitExceededError,
  trackLLMCost,
  getCostProvider,
  setCostProvider,
  drainAlerts,
} from './cost.js';

export {
  increment,
  recordCheck,
  recordApproval,
  getMetrics,
  getCounter,
  resetMetrics,
} from './metrics.js';

export {
  resolveChildCapabilities,
  validateNoEscalation,
  isEscalation,
  CapabilityEscalationError,
} from './inheritance.js';

export {
  backupProfile,
  rollbackProfile,
  hasBackup,
} from './rollback.js';

// Phase 3
export {
  profileShow,
  profileDiff,
  profileSet,
  profileRollback,
  profileValidate,
  profileExplain,
  diffCapabilities,
  formatCapabilityValue,
  CAPABILITY_METADATA,
} from './cli.js';

export {
  migrateProfile,
} from './migration.js';
