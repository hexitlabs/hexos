/**
 * HexOS Capability System — Phase 1 (v0.8.0)
 *
 * Central export for the deployment profile / capability system.
 */

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
