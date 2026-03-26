/**
 * HexOS Multi-Agent Capability Inheritance — Phase 2 (v0.8.0)
 *
 * Resolves capabilities for sub-agents based on three inheritance modes:
 * 'inherit', 'profile-default', and 'explicit'.
 *
 * Enforces the Never Escalate Rule: child capabilities can NEVER exceed
 * their parent's resolved capabilities.
 *
 * See PRD §8 for specification.
 */

import { PROFILES } from './presets.js';
import { CAPABILITY_KEYS } from './types.js';
import { deepMerge } from './resolver.js';

/**
 * @typedef {'inherit' | 'profile-default' | 'explicit'} InheritanceMode
 */

/**
 * Restrictiveness ordering for enum capabilities.
 * Higher index = more restrictive. Used for escalation comparison.
 */
const RESTRICTIVENESS = {
  exec: { unrestricted: 0, allowlist: 1, disabled: 2 },
  browser: { full: 0, sandboxed: 1, disabled: 2 },
  fileSystem: { full: 0, 'workspace-only': 1, 'read-only': 2 },
  network: { unrestricted: 0, 'egress-controlled': 1, 'internal-only': 2 },
  skillInstall: { any: 0, 'vetted-only': 1, disabled: 2 },
  agentSpawn: { unlimited: 0, 'budget-limited': 1, 'operator-approved': 2, disabled: 3 },
  approvalGates: { none: 0, 'external-only': 1, destructive: 2, all: 3 },
  auditTrail: { disabled: 0, local: 1, remote: 2 },
  externalAgentComms: { unrestricted: 0, 'authenticated-only': 1, disabled: 2 },
  vaultAccess: { full: 0, 'read-only': 1, 'injected-only': 2, disabled: 3 },
};

/**
 * Boolean capabilities where `true` = more permissive.
 * Child cannot be true if parent is false.
 */
const BOOLEAN_PERMISSIVE_CAPS = [
  'selfUpdate', 'configEdit', 'workspaceEdit', 'codeModification',
  'channelBindings', 'cronScheduling', 'httpServer', 'adminApi',
];

/**
 * Boolean capabilities where `true` = more restrictive (security feature).
 * Child cannot be false if parent is true. (Can't disable parent's security.)
 */
const BOOLEAN_SECURITY_CAPS = ['leakScanner'];

/**
 * Error thrown when child capabilities exceed parent's.
 */
export class CapabilityEscalationError extends Error {
  /**
   * @param {string} capability - The capability that was escalated
   * @param {*} parentValue - Parent's capability value
   * @param {*} childValue - Child's attempted value
   */
  constructor(capability, parentValue, childValue) {
    const parentStr = typeof parentValue === 'object' ? JSON.stringify(parentValue) : String(parentValue);
    const childStr = typeof childValue === 'object' ? JSON.stringify(childValue) : String(childValue);
    super(
      `🚫 Capability escalation blocked: ${capability}\n` +
      `   Parent: ${parentStr}\n` +
      `   Child:  ${childStr}\n` +
      `   Child capabilities can never exceed parent capabilities.`
    );
    this.name = 'CapabilityEscalationError';
    this.capability = capability;
    this.parentValue = parentValue;
    this.childValue = childValue;
  }
}

/**
 * Compare two values for a single capability and determine if childVal
 * exceeds (is more permissive than) parentVal.
 *
 * @param {string} key - Capability key
 * @param {*} parentVal - Parent's value
 * @param {*} childVal - Child's value
 * @returns {boolean} true if child exceeds parent (escalation detected)
 */
export function isEscalation(key, parentVal, childVal) {
  // ── Structured capabilities with mode field ──
  if (key === 'exec' || key === 'browser') {
    const order = RESTRICTIVENESS[key];
    const parentMode = typeof parentVal === 'object' ? parentVal.mode : parentVal;
    const childMode = typeof childVal === 'object' ? childVal.mode : childVal;
    const parentLevel = order[parentMode];
    const childLevel = order[childMode];
    if (parentLevel !== undefined && childLevel !== undefined && childLevel < parentLevel) {
      return true; // Child is less restrictive
    }
    // For exec allowlist: child can't have commands parent doesn't have
    if (key === 'exec' && parentVal?.mode === 'allowlist' && childVal?.mode === 'allowlist') {
      const parentList = new Set(parentVal.allowlist || []);
      const childList = childVal.allowlist || [];
      for (const cmd of childList) {
        if (!parentList.has(cmd)) return true;
      }
    }
    return false;
  }

  // ── approvalGates: mode + bypassScheduled ──
  if (key === 'approvalGates') {
    const order = RESTRICTIVENESS.approvalGates;
    const parentMode = parentVal?.mode;
    const childMode = childVal?.mode;
    const parentLevel = order[parentMode];
    const childLevel = order[childMode];
    // Less restrictive mode = escalation
    if (parentLevel !== undefined && childLevel !== undefined && childLevel < parentLevel) {
      return true;
    }
    // bypassScheduled: child true when parent false = escalation
    if (childVal?.bypassScheduled === true && parentVal?.bypassScheduled === false) {
      return true;
    }
    return false;
  }

  // ── costLimits: field-by-field ──
  if (key === 'costLimits') {
    for (const field of ['monthlyDollars', 'perSessionDollars', 'perTaskDollars']) {
      const pv = parentVal?.[field];
      const cv = childVal?.[field];
      // Parent has a limit, child removes it → escalation
      if (pv !== null && pv !== undefined && cv === null) return true;
      // Parent has a limit, child has higher limit → escalation
      if (pv !== null && pv !== undefined && cv !== null && cv !== undefined && cv > pv) return true;
    }
    // alertAtPercent: child higher than parent = less alert = escalation
    if (parentVal?.alertAtPercent != null && childVal?.alertAtPercent != null) {
      if (childVal.alertAtPercent > parentVal.alertAtPercent) return true;
    }
    return false;
  }

  // ── Enum capabilities with ordering ──
  if (key in RESTRICTIVENESS) {
    const order = RESTRICTIVENESS[key];
    const parentLevel = order[parentVal];
    const childLevel = order[childVal];
    if (parentLevel !== undefined && childLevel !== undefined && childLevel < parentLevel) {
      return true;
    }
    return false;
  }

  // ── Boolean permissive caps (true = permissive) ──
  if (BOOLEAN_PERMISSIVE_CAPS.includes(key)) {
    if (parentVal === false && childVal === true) return true;
    return false;
  }

  // ── Boolean security caps (true = restrictive) ──
  if (BOOLEAN_SECURITY_CAPS.includes(key)) {
    if (parentVal === true && childVal === false) return true;
    return false;
  }

  // ── agentConcurrency ──
  if (key === 'agentConcurrency') {
    // Parent limited, child unlimited → escalation
    if (parentVal !== -1 && childVal === -1) return true;
    // Child higher than parent → escalation
    if (parentVal !== -1 && childVal > parentVal) return true;
    return false;
  }

  // ── agentToolProfiles (array) ──
  if (key === 'agentToolProfiles') {
    const parentSet = new Set(parentVal || []);
    for (const profile of (childVal || [])) {
      if (!parentSet.has(profile)) return true;
    }
    return false;
  }

  // ── agentCapabilityInheritance: no ordering, all valid ──
  if (key === 'agentCapabilityInheritance') {
    return false; // No escalation possible — all modes valid
  }

  return false;
}

/**
 * Validate that no child capability exceeds the parent.
 *
 * @param {import('./types.js').HexOSCapabilities} parentCaps - Parent's resolved capabilities
 * @param {import('./types.js').HexOSCapabilities} childCaps - Child's resolved capabilities
 * @throws {CapabilityEscalationError} If any escalation is detected
 */
export function validateNoEscalation(parentCaps, childCaps) {
  for (const key of CAPABILITY_KEYS) {
    if (!(key in childCaps)) continue;

    const parentVal = parentCaps[key];
    const childVal = childCaps[key];

    if (isEscalation(key, parentVal, childVal)) {
      throw new CapabilityEscalationError(key, parentVal, childVal);
    }
  }
}

/**
 * Clamp a child's capabilities so they never exceed the parent.
 * Returns a new object with each capability clamped to the parent's level.
 *
 * @param {import('./types.js').HexOSCapabilities} parentCaps
 * @param {import('./types.js').HexOSCapabilities} childCaps
 * @returns {import('./types.js').HexOSCapabilities}
 */
function clampToParent(parentCaps, childCaps) {
  const result = { ...childCaps };

  for (const key of CAPABILITY_KEYS) {
    if (!(key in result)) continue;
    if (!isEscalation(key, parentCaps[key], result[key])) continue;

    // Child exceeds parent — clamp to parent value
    result[key] = structuredClone
      ? structuredClone(parentCaps[key])
      : JSON.parse(JSON.stringify(parentCaps[key]));
  }

  return result;
}

/**
 * Resolve capabilities for a child/sub-agent based on inheritance mode.
 *
 * @param {import('./types.js').HexOSCapabilities} parentCaps - Parent's resolved capabilities
 * @param {string} childProfile - Child's profile name ('sovereign', 'operator', 'managed')
 * @param {object} [childOverrides] - Explicit capability overrides for the child
 * @param {InheritanceMode} [mode='inherit'] - Inheritance mode
 * @returns {import('./types.js').HexOSCapabilities} Resolved child capabilities (never exceeds parent)
 * @throws {CapabilityEscalationError} In 'explicit' mode, if overrides exceed parent
 */
export function resolveChildCapabilities(parentCaps, childProfile, childOverrides = {}, mode = 'inherit') {
  const childPreset = PROFILES[childProfile];
  if (!childPreset) {
    throw new Error(`Unknown child profile: "${childProfile}". Must be one of: sovereign, operator, managed`);
  }

  let childCaps;

  switch (mode) {
    case 'inherit': {
      // Child gets parent's resolved caps, then clamped to child preset as ceiling
      // The more restrictive value wins for each capability
      const inherited = { ...parentCaps };
      childCaps = clampToParent(parentCaps, inherited);
      break;
    }

    case 'profile-default': {
      // Child gets its own profile preset, then clamped to parent
      childCaps = clampToParent(parentCaps, { ...childPreset });
      break;
    }

    case 'explicit': {
      // Parent provides explicit overrides. Validate no escalation.
      const baseCaps = deepMerge(childPreset, childOverrides);
      // Strict mode: throw if overrides escalate beyond parent
      validateNoEscalation(parentCaps, baseCaps);
      childCaps = baseCaps;
      break;
    }

    default:
      throw new Error(`Unknown inheritance mode: "${mode}". Must be: inherit, profile-default, explicit`);
  }

  return childCaps;
}
