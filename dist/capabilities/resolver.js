/**
 * HexOS Profile Resolver — loads preset, applies overrides, validates,
 * and freezes the resolved capability set.
 *
 * See PRD §4.3 for override restriction rules and §5.1 for gate functions.
 */

import { PROFILES, PROFILE_NAMES } from './presets.js';
import { CAPABILITY_KEYS, STRUCTURED_CAPABILITY_KEYS, ARRAY_CAPABILITY_KEYS } from './types.js';
import { CapabilityDeniedError } from './errors.js';

/** @type {Readonly<import('./types.js').HexOSCapabilities> | null} */
let resolvedCaps = null;

/** @type {string | null} */
let resolvedProfile = null;

/** @type {string[]} */
let initWarnings = [];

// ── Override Restriction Rules ─────────────────────────────────
//
// General rule: profiles can opt INTO restrictions but not OUT of them.
// Sovereign can add guardrails. Managed cannot remove them.

/**
 * Restrictiveness ordering for enum capabilities.
 * Higher index = more restrictive.
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
 * Boolean capabilities where `false` is MORE restrictive.
 * Override can set true→false (restrict) but not false→true (escalate).
 */
const BOOLEAN_RESTRICT_CAPS = [
  'selfUpdate',
  'configEdit',
  'workspaceEdit',
  'codeModification',
  'channelBindings',
  'cronScheduling',
  'httpServer',
  'adminApi',
];

/**
 * Boolean capabilities where `true` is MORE restrictive (security features).
 * Override can set false→true (add security) but not true→false (remove security).
 */
const BOOLEAN_SECURITY_CAPS = [
  'leakScanner',
];

/**
 * Deep-merge two objects. Arrays are replaced, not concatenated.
 * Only merges plain objects; primitives and arrays are overwritten.
 */
export function deepMerge(target, source) {
  const result = { ...target };

  for (const key of Object.keys(source)) {
    const sourceVal = source[key];
    const targetVal = result[key];

    if (
      sourceVal !== null &&
      typeof sourceVal === 'object' &&
      !Array.isArray(sourceVal) &&
      targetVal !== null &&
      typeof targetVal === 'object' &&
      !Array.isArray(targetVal)
    ) {
      result[key] = deepMerge(targetVal, sourceVal);
    } else {
      result[key] = sourceVal;
    }
  }

  return result;
}

/**
 * Deep-freeze an object recursively.
 */
function deepFreeze(obj) {
  Object.freeze(obj);
  for (const val of Object.values(obj)) {
    if (val !== null && typeof val === 'object' && !Object.isFrozen(val)) {
      deepFreeze(val);
    }
  }
  return obj;
}

/**
 * Validate that overrides don't escalate beyond the profile's preset.
 *
 * @param {string} profileName - The profile name
 * @param {object} overrides - The capability overrides
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function validateOverrides(profileName, overrides) {
  const errors = [];
  const warnings = [];
  const preset = PROFILES[profileName];

  if (!preset) {
    errors.push(`Unknown profile: "${profileName}". Must be one of: ${PROFILE_NAMES.join(', ')}`);
    return { errors, warnings };
  }

  for (const key of Object.keys(overrides)) {
    // Warn on unknown capability keys (forward-compat for Phase 2 fleet caps)
    if (!CAPABILITY_KEYS.includes(key)) {
      warnings.push(`Unknown capability override "${key}" — ignored (forward-compat).`);
      continue;
    }

    const presetValue = preset[key];
    const overrideValue = overrides[key];

    // ── Structured capability overrides (exec, browser, approvalGates, costLimits) ──

    if (key === 'exec') {
      const err = validateExecOverride(profileName, presetValue, overrideValue);
      if (err) errors.push(err);
      continue;
    }

    if (key === 'browser') {
      const err = validateBrowserOverride(profileName, presetValue, overrideValue);
      if (err) errors.push(err);
      continue;
    }

    if (key === 'approvalGates') {
      const err = validateApprovalGatesOverride(profileName, presetValue, overrideValue);
      if (err) errors.push(err);
      continue;
    }

    if (key === 'costLimits') {
      const err = validateCostLimitsOverride(profileName, presetValue, overrideValue);
      if (err) errors.push(err);
      continue;
    }

    // ── Enum capabilities with restrictiveness ordering ──

    if (key in RESTRICTIVENESS) {
      const order = RESTRICTIVENESS[key];
      const presetLevel = order[presetValue];
      const overrideLevel = order[overrideValue];

      if (overrideLevel === undefined) {
        errors.push(`Invalid value for ${key}: "${overrideValue}". Valid: ${Object.keys(order).join(', ')}`);
      } else if (overrideLevel < presetLevel) {
        errors.push(
          `Cannot escalate ${key} from "${presetValue}" to "${overrideValue}" in ${profileName} profile. ` +
          `Profiles can opt INTO restrictions but not OUT of them.`
        );
      }
      continue;
    }

    // ── Boolean capabilities ──

    if (BOOLEAN_RESTRICT_CAPS.includes(key)) {
      if (typeof overrideValue !== 'boolean') {
        errors.push(`Invalid value for ${key}: expected boolean, got ${typeof overrideValue}`);
      } else if (overrideValue === true && presetValue === false) {
        // Trying to enable something the profile disables → escalation
        errors.push(
          `Cannot escalate ${key} from false to true in ${profileName} profile. ` +
          `Profiles can opt INTO restrictions but not OUT of them.`
        );
      }
      continue;
    }

    if (BOOLEAN_SECURITY_CAPS.includes(key)) {
      if (typeof overrideValue !== 'boolean') {
        errors.push(`Invalid value for ${key}: expected boolean, got ${typeof overrideValue}`);
      } else if (overrideValue === false && presetValue === true) {
        // Trying to disable a security feature → escalation
        errors.push(
          `Cannot disable ${key} in ${profileName} profile. ` +
          `Security features can be enabled but not disabled.`
        );
      }
      continue;
    }

    // ── Numeric capabilities (agentConcurrency) ──

    if (key === 'agentConcurrency') {
      if (typeof overrideValue !== 'number') {
        errors.push(`Invalid value for agentConcurrency: expected number, got ${typeof overrideValue}`);
      } else if (presetValue !== -1 && overrideValue === -1) {
        errors.push(
          `Cannot set agentConcurrency to unlimited (-1) in ${profileName} profile. ` +
          `Can only decrease concurrency limit.`
        );
      } else if (presetValue !== -1 && overrideValue > presetValue) {
        errors.push(
          `Cannot increase agentConcurrency from ${presetValue} to ${overrideValue} in ${profileName} profile. ` +
          `Can only decrease concurrency limit.`
        );
      }
      continue;
    }

    // ── Array capabilities (agentToolProfiles) ──

    if (key === 'agentToolProfiles') {
      if (!Array.isArray(overrideValue)) {
        errors.push(`Invalid value for agentToolProfiles: expected array, got ${typeof overrideValue}`);
      } else {
        // Check that override doesn't add profiles not in preset
        const presetSet = new Set(presetValue);
        for (const profile of overrideValue) {
          if (!presetSet.has(profile)) {
            errors.push(
              `Cannot add tool profile "${profile}" in ${profileName} profile. ` +
              `Available profiles: ${presetValue.join(', ')}.`
            );
          }
        }
      }
      continue;
    }

    // ── agentCapabilityInheritance ──

    if (key === 'agentCapabilityInheritance') {
      // No restrictiveness ordering — all modes are valid for all profiles
      const validModes = ['inherit', 'profile-default', 'explicit'];
      if (!validModes.includes(overrideValue)) {
        errors.push(`Invalid value for agentCapabilityInheritance: "${overrideValue}". Valid: ${validModes.join(', ')}`);
      }
      continue;
    }
  }

  return { errors, warnings };
}

/**
 * Validate exec capability override.
 */
function validateExecOverride(profileName, preset, override) {
  if (!override || typeof override !== 'object') {
    return `Invalid exec override: expected object`;
  }

  if (override.mode !== undefined) {
    const order = RESTRICTIVENESS.exec;
    const presetLevel = order[preset.mode];
    const overrideLevel = order[override.mode];

    if (overrideLevel === undefined) {
      return `Invalid exec.mode: "${override.mode}". Valid: ${Object.keys(order).join(', ')}`;
    }

    if (overrideLevel < presetLevel) {
      return (
        `Cannot escalate exec.mode from "${preset.mode}" to "${override.mode}" in ${profileName} profile. ` +
        `Profiles can opt INTO restrictions but not OUT of them.`
      );
    }
  }

  // Allowlist can be widened or narrowed — no restriction on the list contents
  // (only mode escalation is blocked)

  return null;
}

/**
 * Validate browser capability override.
 */
function validateBrowserOverride(profileName, preset, override) {
  if (!override || typeof override !== 'object') {
    return `Invalid browser override: expected object`;
  }

  if (override.mode !== undefined) {
    const order = RESTRICTIVENESS.browser;
    const presetLevel = order[preset.mode];
    const overrideLevel = order[override.mode];

    if (overrideLevel === undefined) {
      return `Invalid browser.mode: "${override.mode}". Valid: ${Object.keys(order).join(', ')}`;
    }

    if (overrideLevel < presetLevel) {
      return (
        `Cannot escalate browser.mode from "${preset.mode}" to "${override.mode}" in ${profileName} profile. ` +
        `Profiles can opt INTO restrictions but not OUT of them.`
      );
    }
  }

  return null;
}

/**
 * Validate approvalGates capability override.
 */
function validateApprovalGatesOverride(profileName, preset, override) {
  if (!override || typeof override !== 'object') {
    return `Invalid approvalGates override: expected object`;
  }

  if (override.mode !== undefined) {
    const order = RESTRICTIVENESS.approvalGates;
    const presetLevel = order[preset.mode];
    const overrideLevel = order[override.mode];

    if (overrideLevel === undefined) {
      return `Invalid approvalGates.mode: "${override.mode}". Valid: ${Object.keys(order).join(', ')}`;
    }

    if (overrideLevel < presetLevel) {
      return (
        `Cannot relax approvalGates.mode from "${preset.mode}" to "${override.mode}" in ${profileName} profile. ` +
        `Profiles can opt INTO restrictions but not OUT of them.`
      );
    }
  }

  // bypassScheduled: can set true→false (more restrictive) but not false→true
  if (override.bypassScheduled !== undefined) {
    if (override.bypassScheduled === true && preset.bypassScheduled === false) {
      return (
        `Cannot enable approvalGates.bypassScheduled in ${profileName} profile. ` +
        `Can only add restrictions, not remove them.`
      );
    }
  }

  return null;
}

/**
 * Validate costLimits capability override.
 */
function validateCostLimitsOverride(profileName, preset, override) {
  if (!override || typeof override !== 'object') {
    return `Invalid costLimits override: expected object`;
  }

  // For cost limits, the rule is:
  // - Can lower limits (more restrictive)
  // - Can add limits where none existed (null → number)
  // - Cannot raise limits above preset (escalation)
  // - Cannot remove limits (number → null) unless preset is null
  for (const field of ['monthlyDollars', 'perSessionDollars', 'perTaskDollars']) {
    if (override[field] === undefined) continue;

    const presetVal = preset[field];
    const overrideVal = override[field];

    if (presetVal !== null && overrideVal === null) {
      return (
        `Cannot remove ${field} limit in ${profileName} profile. ` +
        `Can only lower cost limits, not remove them.`
      );
    }

    if (presetVal !== null && overrideVal !== null && overrideVal > presetVal) {
      return (
        `Cannot increase ${field} from $${presetVal} to $${overrideVal} in ${profileName} profile. ` +
        `Can only lower cost limits.`
      );
    }
  }

  // alertAtPercent: can only lower the alert threshold (get warned earlier)
  if (override.alertAtPercent !== undefined) {
    if (typeof override.alertAtPercent !== 'number') {
      return `Invalid costLimits.alertAtPercent: expected number`;
    }
    if (override.alertAtPercent > preset.alertAtPercent) {
      return (
        `Cannot increase alertAtPercent from ${preset.alertAtPercent} to ${override.alertAtPercent} in ${profileName} profile. ` +
        `Can only lower the alert threshold.`
      );
    }
  }

  return null;
}

// ── Public API ─────────────────────────────────────────────────

/**
 * Initialize the capability system from config.
 *
 * @param {object} config - HexOS config object
 * @param {string} config.profile - Profile name (sovereign/operator/managed)
 * @param {string} [config.deploymentProfile] - Legacy profile name (backward compat)
 * @param {object} [config.capabilities] - Capability overrides
 * @param {object} [options] - Options
 * @param {object} [options.logger] - Logger instance (defaults to console)
 * @returns {{ capabilities: Readonly<import('./types.js').HexOSCapabilities>, profile: string, warnings: string[] }}
 * @throws {Error} If config is invalid
 */
export function initCapabilities(config, options = {}) {
  const logger = options.logger || console;

  // Resolve profile name: `profile` wins over `deploymentProfile`
  let profileName = config.profile || config.deploymentProfile;

  // Legacy mapping: old "operator" → "sovereign" (see PRD §15.1)
  if (!config.profile && config.deploymentProfile) {
    if (config.deploymentProfile === 'operator') {
      profileName = 'sovereign';
      logger.warn?.(
        'Legacy deploymentProfile "operator" mapped to "sovereign". ' +
        'Run `hexos migrate-profile` to update config.'
      );
    }
  }

  if (!profileName) {
    profileName = 'sovereign'; // Default for self-installs
  }

  if (!PROFILE_NAMES.includes(profileName)) {
    throw new Error(
      `Invalid profile: "${profileName}". Must be one of: ${PROFILE_NAMES.join(', ')}`
    );
  }

  const preset = PROFILES[profileName];
  const overrides = config.capabilities || {};

  // Validate overrides
  const { errors, warnings } = validateOverrides(profileName, overrides);

  if (errors.length > 0) {
    throw new Error(
      `Invalid capability overrides for ${profileName} profile:\n` +
      errors.map(e => `  • ${e}`).join('\n')
    );
  }

  // Warn about issues
  for (const warn of warnings) {
    logger.warn?.(`[capabilities] ${warn}`);
  }

  // Filter out unknown keys before merge
  const knownOverrides = {};
  for (const key of Object.keys(overrides)) {
    if (CAPABILITY_KEYS.includes(key)) {
      knownOverrides[key] = overrides[key];
    }
  }

  // Merge: preset + overrides (deep merge for structured caps)
  const merged = deepMerge(preset, knownOverrides);

  // Deep-freeze the resolved capabilities
  const frozen = deepFreeze(merged);

  // Store globally
  resolvedCaps = frozen;
  resolvedProfile = profileName;
  initWarnings = warnings;

  logger.info?.(`[capabilities] Profile: ${profileName} (${Object.keys(knownOverrides).length} overrides)`);

  return {
    capabilities: frozen,
    profile: profileName,
    warnings,
  };
}

/**
 * Get a single capability value.
 *
 * @template {keyof import('./types.js').HexOSCapabilities} K
 * @param {K} key
 * @returns {import('./types.js').HexOSCapabilities[K]}
 */
export function getCapability(key) {
  if (!resolvedCaps) {
    throw new Error('Capabilities not initialized. Call initCapabilities() first.');
  }
  return resolvedCaps[key];
}

/**
 * Require a capability to have a specific value, or throw CapabilityDeniedError.
 *
 * For boolean capabilities: pass the required boolean.
 * For enum capabilities: checks if current value meets the minimum requirement.
 *
 * @param {string} key - Capability key
 * @param {*} required - Required value
 * @param {string} action - Description of the action being attempted
 * @throws {CapabilityDeniedError}
 */
export function requireCapability(key, required, action) {
  if (!resolvedCaps) {
    throw new Error('Capabilities not initialized. Call initCapabilities() first.');
  }

  const current = resolvedCaps[key];

  // Direct match
  if (current === required) return;

  // For structured capabilities, check the mode field
  if (typeof current === 'object' && current !== null && !Array.isArray(current)) {
    if (typeof required === 'object' && required !== null) {
      // Deep comparison not needed for requireCapability — use getCapability for structured
      return;
    }
    // If required is a string, check if mode matches
    if ('mode' in current && current.mode === required) return;
  }

  // Boolean check
  if (typeof required === 'boolean' && current === required) return;

  // Enum restrictiveness check: is current at least as permissive as required?
  if (key in RESTRICTIVENESS && typeof required === 'string' && typeof current === 'string') {
    const order = RESTRICTIVENESS[key];
    const currentLevel = order[current];
    const requiredLevel = order[required];
    if (currentLevel !== undefined && requiredLevel !== undefined && currentLevel <= requiredLevel) {
      return; // Current is at least as permissive as required
    }
  }

  // Denied
  const detail = typeof current === 'object' ? JSON.stringify(current) : String(current);
  throw new CapabilityDeniedError(key, action, detail, resolvedProfile);
}

/**
 * Get the resolved profile name.
 * @returns {string|null}
 */
export function getResolvedProfile() {
  return resolvedProfile;
}

/**
 * Get the full resolved capabilities object.
 * @returns {Readonly<import('./types.js').HexOSCapabilities>|null}
 */
export function getResolvedCapabilities() {
  return resolvedCaps;
}

/**
 * Reset the capability system (for testing only).
 */
export function resetCapabilities() {
  resolvedCaps = null;
  resolvedProfile = null;
  initWarnings = [];
}
