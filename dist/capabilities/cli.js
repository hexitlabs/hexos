/**
 * HexOS Profile CLI — Phase 3 (v0.8.0)
 *
 * Importable/testable functions for 6 `hexos profile` subcommands:
 *   show, diff, set, rollback, validate, explain
 *
 * Each function returns structured output and/or prints to a provided
 * output stream (defaults to process.stdout). This allows both CLI
 * usage and programmatic testing.
 *
 * See PRD §11 for specification.
 */

import { PROFILES, PROFILE_NAMES } from './presets.js';
import { CAPABILITY_KEYS, STRUCTURED_CAPABILITY_KEYS } from './types.js';
import {
  initCapabilities,
  getResolvedProfile,
  getResolvedCapabilities,
  resetCapabilities,
  validateOverrides,
  deepMerge,
} from './resolver.js';
import { backupProfile, rollbackProfile, hasBackup } from './rollback.js';
import { CAPABILITY_FIX_HINTS } from './errors.js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// ── Capability metadata for explain + show ──────────────────────

/** @type {Record<string, { name: string, description: string, layer: string, values?: Record<string, string> }>} */
export const CAPABILITY_METADATA = {
  exec: {
    name: 'exec',
    description: 'Shell command execution',
    layer: 'Execution',
    values: {
      unrestricted: 'Any command, no restrictions',
      allowlist: 'Only commands in exec.allowlist',
      disabled: 'No shell access',
    },
  },
  browser: {
    name: 'browser',
    description: 'Browser automation',
    layer: 'Execution',
    values: {
      full: 'Full browser access, no restrictions',
      sandboxed: 'Navigation allowlist, download/extension blocking',
      disabled: 'No browser access',
    },
  },
  fileSystem: {
    name: 'fileSystem',
    description: 'Filesystem access scope',
    layer: 'Execution',
    values: {
      full: 'Full filesystem access',
      'workspace-only': 'Restricted to workspace directory',
      'read-only': 'Read-only filesystem access',
    },
  },
  network: {
    name: 'network',
    description: 'Outbound network access',
    layer: 'Execution',
    values: {
      unrestricted: 'No network restrictions',
      'egress-controlled': 'Outbound traffic filtered by egress policy',
      'internal-only': 'No external network access',
    },
  },
  selfUpdate: {
    name: 'selfUpdate',
    description: 'Can the agent update its own HexOS binary',
    layer: 'Self-Modification',
    values: { true: 'Enabled', false: 'Disabled' },
  },
  skillInstall: {
    name: 'skillInstall',
    description: 'Skill/plugin installation',
    layer: 'Self-Modification',
    values: {
      any: 'Install any skill',
      'vetted-only': 'Only skills in the vetted registry',
      disabled: 'No skill installation',
    },
  },
  configEdit: {
    name: 'configEdit',
    description: 'Can the agent edit hexos.json',
    layer: 'Self-Modification',
    values: { true: 'Enabled', false: 'Disabled' },
  },
  workspaceEdit: {
    name: 'workspaceEdit',
    description: 'Can the agent modify its own workspace files',
    layer: 'Self-Modification',
    values: { true: 'Enabled', false: 'Disabled' },
  },
  codeModification: {
    name: 'codeModification',
    description: 'Can the agent modify HexOS source code',
    layer: 'Self-Modification',
    values: { true: 'Enabled', false: 'Disabled' },
  },
  agentSpawn: {
    name: 'agentSpawn',
    description: 'Sub-agent spawning',
    layer: 'Agents',
    values: {
      unlimited: 'No restrictions on spawning',
      'budget-limited': 'Spawning limited by cost budget',
      'operator-approved': 'Requires operator approval to spawn',
      disabled: 'No sub-agent spawning',
    },
  },
  agentConcurrency: {
    name: 'agentConcurrency',
    description: 'Maximum concurrent sub-agents (-1 = unlimited)',
    layer: 'Agents',
  },
  agentToolProfiles: {
    name: 'agentToolProfiles',
    description: 'Tool profiles available to sub-agents',
    layer: 'Agents',
  },
  agentCapabilityInheritance: {
    name: 'agentCapabilityInheritance',
    description: 'Capability inheritance mode for sub-agents',
    layer: 'Agents',
    values: {
      inherit: 'Sub-agent inherits parent capabilities (capped)',
      'profile-default': 'Sub-agent uses its own profile defaults',
      explicit: 'Parent must declare sub-agent capabilities',
    },
  },
  approvalGates: {
    name: 'approvalGates',
    description: 'When actions need human/operator approval',
    layer: 'Guardrails',
    values: {
      none: 'No approval required',
      'external-only': 'External actions require approval',
      destructive: 'Destructive and external actions require approval',
      all: 'All actions require approval',
    },
  },
  auditTrail: {
    name: 'auditTrail',
    description: 'Audit trail logging',
    layer: 'Guardrails',
    values: {
      disabled: 'No audit logging',
      local: 'Audit logs stored locally',
      remote: 'Audit logs sent to remote server',
    },
  },
  leakScanner: {
    name: 'leakScanner',
    description: 'Leak detection scanner on outbound content',
    layer: 'Guardrails',
    values: { true: 'Enabled', false: 'Disabled' },
  },
  costLimits: {
    name: 'costLimits',
    description: 'LLM cost limits (monthly, per-session, per-task)',
    layer: 'Guardrails',
  },
  externalAgentComms: {
    name: 'externalAgentComms',
    description: 'External agent communication (MCP, A2A)',
    layer: 'Guardrails',
    values: {
      unrestricted: 'No restrictions on agent communication',
      'authenticated-only': 'Only authenticated agent connections',
      disabled: 'No external agent communication',
    },
  },
  channelBindings: {
    name: 'channelBindings',
    description: 'Channel bindings (Telegram, Discord, Signal)',
    layer: 'Infrastructure',
    values: { true: 'Enabled', false: 'Disabled' },
  },
  cronScheduling: {
    name: 'cronScheduling',
    description: 'Cron/heartbeat scheduling',
    layer: 'Infrastructure',
    values: { true: 'Enabled', false: 'Disabled' },
  },
  vaultAccess: {
    name: 'vaultAccess',
    description: 'Vault credential access level',
    layer: 'Infrastructure',
    values: {
      full: 'Full vault access',
      'read-only': 'Read-only vault access',
      'injected-only': 'Only operator-injected credentials',
      disabled: 'No vault access',
    },
  },
  httpServer: {
    name: 'httpServer',
    description: 'HTTP gateway server',
    layer: 'Infrastructure',
    values: { true: 'Enabled', false: 'Disabled' },
  },
  adminApi: {
    name: 'adminApi',
    description: 'Admin API (config management, diagnostics)',
    layer: 'Infrastructure',
    values: { true: 'Enabled', false: 'Disabled' },
  },
};

/** Capability layers in display order */
const LAYERS = ['Execution', 'Self-Modification', 'Agents', 'Guardrails', 'Infrastructure'];

/** Group capabilities by layer */
function groupByLayer() {
  const groups = {};
  for (const layer of LAYERS) {
    groups[layer] = [];
  }
  for (const key of CAPABILITY_KEYS) {
    const meta = CAPABILITY_METADATA[key];
    if (meta) {
      groups[meta.layer].push(key);
    }
  }
  return groups;
}

// ── Formatting helpers ──────────────────────────────────────────

/**
 * Format a capability value for human-readable display.
 * @param {string} key
 * @param {*} value
 * @returns {string}
 */
export function formatCapabilityValue(key, value) {
  if (value === null || value === undefined) return 'null';

  if (typeof value === 'boolean') return value ? 'yes' : 'no';

  if (typeof value === 'number') {
    if (key === 'agentConcurrency' && value === -1) return 'unlimited';
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.join(', ');
  }

  if (typeof value === 'object') {
    // Structured capabilities — format key fields
    if (key === 'exec') {
      if (value.mode === 'allowlist') {
        return `allowlist [${(value.allowlist || []).join(', ')}]`;
      }
      return value.mode;
    }
    if (key === 'browser') {
      if (value.mode === 'sandboxed') {
        const parts = [value.mode];
        if (value.navigationAllowlist?.length) {
          parts.push(`domains: ${value.navigationAllowlist.join(', ')}`);
        }
        if (value.blockDownloads) parts.push('no-downloads');
        if (value.blockExtensions) parts.push('no-extensions');
        return parts.join(', ');
      }
      return value.mode;
    }
    if (key === 'approvalGates') {
      const parts = [value.mode];
      if (value.bypassScheduled) parts.push('bypass-scheduled');
      return parts.join(', ');
    }
    if (key === 'costLimits') {
      const parts = [];
      if (value.monthlyDollars !== null) parts.push(`$${value.monthlyDollars}/mo`);
      else parts.push('unlimited/mo');
      if (value.perSessionDollars !== null) parts.push(`$${value.perSessionDollars}/session`);
      if (value.perTaskDollars !== null) parts.push(`$${value.perTaskDollars}/task`);
      parts.push(`alert@${value.alertAtPercent}%`);
      return parts.join(', ');
    }
    return JSON.stringify(value);
  }

  return String(value);
}

// ── Diff helper ─────────────────────────────────────────────────

/**
 * Compute differences between two capability sets.
 * Returns an array of { key, value1, value2 } for differing capabilities.
 *
 * @param {object} caps1 - First capability set
 * @param {object} caps2 - Second capability set
 * @returns {Array<{ key: string, value1: string, value2: string }>}
 */
export function diffCapabilities(caps1, caps2) {
  const diffs = [];

  for (const key of CAPABILITY_KEYS) {
    const v1 = caps1[key];
    const v2 = caps2[key];

    // For structured capabilities, diff individual fields
    if (STRUCTURED_CAPABILITY_KEYS.includes(key)) {
      const subDiffs = diffStructured(key, v1, v2);
      diffs.push(...subDiffs);
      continue;
    }

    // Simple equality for primitives, arrays
    if (JSON.stringify(v1) !== JSON.stringify(v2)) {
      diffs.push({
        key,
        value1: formatCapabilityValue(key, v1),
        value2: formatCapabilityValue(key, v2),
      });
    }
  }

  return diffs;
}

/**
 * Diff individual fields of a structured capability.
 */
function diffStructured(key, v1, v2) {
  const diffs = [];
  if (!v1 || !v2) {
    if (JSON.stringify(v1) !== JSON.stringify(v2)) {
      diffs.push({
        key,
        value1: formatCapabilityValue(key, v1),
        value2: formatCapabilityValue(key, v2),
      });
    }
    return diffs;
  }

  const allFields = new Set([...Object.keys(v1), ...Object.keys(v2)]);
  for (const field of allFields) {
    const f1 = v1[field];
    const f2 = v2[field];
    if (JSON.stringify(f1) !== JSON.stringify(f2)) {
      const fieldKey = `${key}.${field}`;
      const fmt1 = f1 === null ? 'null' : Array.isArray(f1) ? f1.join(', ') : String(f1);
      const fmt2 = f2 === null ? 'null' : Array.isArray(f2) ? f2.join(', ') : String(f2);
      diffs.push({ key: fieldKey, value1: fmt1, value2: fmt2 });
    }
  }

  return diffs;
}

// ── CLI Command Functions ───────────────────────────────────────

/**
 * `hexos profile show` — Display current profile and resolved capabilities.
 *
 * @param {object} config - Current HexOS config
 * @param {object} [options]
 * @param {object} [options.logger] - Logger instance
 * @returns {{ output: string, profile: string, overrideCount: number }}
 */
export function profileShow(config, options = {}) {
  const logger = options.logger || { info() {}, warn() {}, error() {} };
  const result = initCapabilities(config, { logger });
  const caps = result.capabilities;
  const profileName = result.profile;
  const overrideCount = Object.keys(config.capabilities || {}).length;

  const lines = [];
  lines.push(`Profile: ${profileName}`);
  lines.push(`Overrides: ${overrideCount}`);
  lines.push('');

  const groups = groupByLayer();
  for (const layer of LAYERS) {
    lines.push(`${layer}:`);
    for (const key of groups[layer]) {
      const value = caps[key];
      const formatted = formatCapabilityValue(key, value);
      lines.push(`  ${key.padEnd(28)} ${formatted}`);
    }
    lines.push('');
  }

  resetCapabilities();

  const output = lines.join('\n');
  return { output, profile: profileName, overrideCount };
}

/**
 * `hexos profile diff <profile1> <profile2>` — Compare two profiles.
 *
 * @param {string} profile1 - First profile name
 * @param {string} profile2 - Second profile name
 * @returns {{ output: string, diffs: Array<{ key: string, value1: string, value2: string }> }}
 */
export function profileDiff(profile1, profile2) {
  if (!PROFILE_NAMES.includes(profile1)) {
    throw new Error(`Unknown profile: "${profile1}". Must be one of: ${PROFILE_NAMES.join(', ')}`);
  }
  if (!PROFILE_NAMES.includes(profile2)) {
    throw new Error(`Unknown profile: "${profile2}". Must be one of: ${PROFILE_NAMES.join(', ')}`);
  }

  const caps1 = PROFILES[profile1];
  const caps2 = PROFILES[profile2];
  const diffs = diffCapabilities(caps1, caps2);

  if (diffs.length === 0) {
    return { output: `No differences between ${profile1} and ${profile2}.`, diffs };
  }

  const lines = [`Differences: ${profile1} → ${profile2}`, ''];
  const maxKeyLen = Math.max(...diffs.map(d => d.key.length));
  for (const d of diffs) {
    lines.push(`  ${d.key.padEnd(maxKeyLen + 2)} ${d.value1} → ${d.value2}`);
  }

  return { output: lines.join('\n'), diffs };
}

/**
 * `hexos profile set <profile>` — Change the active profile.
 *
 * @param {string} newProfile - Profile to switch to
 * @param {object} [options]
 * @param {string} [options.configPath] - Path to hexos.json
 * @param {string} [options.backupDir] - Directory for backup file
 * @param {object} [options.logger] - Logger instance
 * @param {object} [options.currentConfig] - Override config (for testing)
 * @returns {{ output: string, backup: object, diffs: Array }}
 */
export function profileSet(newProfile, options = {}) {
  const logger = options.logger || { info() {}, warn() {}, error() {} };

  if (!PROFILE_NAMES.includes(newProfile)) {
    throw new Error(`Unknown profile: "${newProfile}". Must be one of: ${PROFILE_NAMES.join(', ')}`);
  }

  // Load current config
  let currentConfig;
  const configPath = options.configPath || 'hexos.json';

  if (options.currentConfig) {
    currentConfig = options.currentConfig;
  } else {
    if (!existsSync(configPath)) {
      throw new Error(`Config file not found: ${configPath}`);
    }
    currentConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
  }

  const currentProfile = currentConfig.profile || 'sovereign';

  if (currentProfile === newProfile) {
    return {
      output: `Already on profile "${newProfile}". No changes needed.`,
      backup: null,
      diffs: [],
    };
  }

  // Backup current config
  const backupDir = options.backupDir || '.';
  const backup = backupProfile(
    { profile: currentProfile, capabilities: currentConfig.capabilities },
    newProfile,
    'cli',
    backupDir
  );

  // Compute diff
  const currentCaps = PROFILES[currentProfile];
  const newCaps = PROFILES[newProfile];
  const diffs = diffCapabilities(currentCaps, newCaps);

  // Build output
  const lines = [];
  lines.push(`⚠️  Changing from ${currentProfile} to ${newProfile}:`);
  lines.push('');

  if (diffs.length > 0) {
    const maxKeyLen = Math.max(...diffs.map(d => d.key.length));
    for (const d of diffs) {
      lines.push(`  ${d.key.padEnd(maxKeyLen + 2)} ${d.value1} → ${d.value2}`);
    }
    lines.push('');
  }

  // Write new config (if not using test override)
  if (!options.currentConfig && existsSync(configPath)) {
    const configData = JSON.parse(readFileSync(configPath, 'utf-8'));
    configData.profile = newProfile;
    // Clear capability overrides when switching profiles
    // (overrides from old profile may be invalid for new one)
    delete configData.capabilities;
    writeFileSync(configPath, JSON.stringify(configData, null, 2) + '\n', 'utf-8');
  }

  lines.push(`Backup saved to .hexos-profile-backup.json`);
  lines.push(`Restart required to apply changes.`);

  return { output: lines.join('\n'), backup, diffs };
}

/**
 * `hexos profile rollback` — Restore previous profile from backup.
 *
 * @param {object} [options]
 * @param {string} [options.configPath] - Path to hexos.json
 * @param {string} [options.backupDir] - Directory containing backup file
 * @param {object} [options.logger] - Logger instance
 * @returns {{ output: string, backup: object, diffs: Array }}
 */
export function profileRollback(options = {}) {
  const logger = options.logger || { info() {}, warn() {}, error() {} };
  const backupDir = options.backupDir || '.';

  if (!hasBackup(backupDir)) {
    throw new Error(
      'No profile backup found. Cannot rollback.\n' +
      'A backup is created automatically when you run `hexos profile set`.'
    );
  }

  const backup = rollbackProfile(backupDir);
  const configPath = options.configPath || 'hexos.json';

  // Compute what will change
  const currentProfile = backup.changedTo; // The profile that was set
  const previousProfile = backup.previousProfile;
  const currentCaps = PROFILES[currentProfile];
  const previousCaps = PROFILES[previousProfile];
  const diffs = diffCapabilities(currentCaps, previousCaps);

  const lines = [];
  lines.push(`Found backup: ${previousProfile} (from ${backup.timestamp})`);
  lines.push(`Rolling back: ${currentProfile} → ${previousProfile}`);
  lines.push('');

  if (diffs.length > 0) {
    const maxKeyLen = Math.max(...diffs.map(d => d.key.length));
    for (const d of diffs) {
      lines.push(`  ${d.key.padEnd(maxKeyLen + 2)} ${d.value1} → ${d.value2}`);
    }
    lines.push('');
  }

  // Restore config file
  if (existsSync(configPath)) {
    const configData = JSON.parse(readFileSync(configPath, 'utf-8'));
    configData.profile = previousProfile;
    if (Object.keys(backup.previousCapabilities || {}).length > 0) {
      configData.capabilities = backup.previousCapabilities;
    } else {
      delete configData.capabilities;
    }
    writeFileSync(configPath, JSON.stringify(configData, null, 2) + '\n', 'utf-8');
  }

  lines.push(`Profile restored to "${previousProfile}".`);
  lines.push(`Restart required to apply changes.`);

  return { output: lines.join('\n'), backup, diffs };
}

/**
 * `hexos profile validate` — Validate the current config.
 *
 * @param {object} config - Current HexOS config
 * @param {object} [options]
 * @param {object} [options.logger] - Logger instance
 * @returns {{ output: string, valid: boolean, errors: string[], warnings: string[], overrideCount: number }}
 */
export function profileValidate(config, options = {}) {
  const logger = options.logger || { info() {}, warn() {}, error() {} };
  const profileName = config.profile || 'sovereign';
  const overrides = config.capabilities || {};
  const overrideCount = Object.keys(overrides).length;

  // Check profile name
  if (!PROFILE_NAMES.includes(profileName)) {
    return {
      output: `❌ Invalid profile: "${profileName}". Must be one of: ${PROFILE_NAMES.join(', ')}`,
      valid: false,
      errors: [`Invalid profile: "${profileName}"`],
      warnings: [],
      overrideCount: 0,
    };
  }

  // Validate overrides
  const { errors, warnings } = validateOverrides(profileName, overrides);

  // Additional semantic warnings
  const semanticWarnings = [];

  // Check for auditTrail=remote without audit server
  if (overrides.auditTrail === 'remote' || (!overrides.auditTrail && PROFILES[profileName].auditTrail === 'remote')) {
    // This is a warning, not an error — the audit server config is outside capabilities
    if (!config.auditServerUrl && !config.audit?.serverUrl) {
      semanticWarnings.push('auditTrail is "remote" but no audit server URL configured.');
    }
  }

  // Check for auditTrail=local without audit dir
  const resolvedAudit = overrides.auditTrail || PROFILES[profileName].auditTrail;
  if (resolvedAudit === 'local' && !config.auditDir && !config.audit?.dir) {
    semanticWarnings.push(
      'auditTrail is "local" but no auditDir configured — will default to ./audit/'
    );
  }

  const allWarnings = [...warnings, ...semanticWarnings];
  const valid = errors.length === 0;

  const lines = [];
  if (valid) {
    lines.push(`✅ Profile "${profileName}" with ${overrideCount} overrides: valid`);
  } else {
    lines.push(`❌ Profile "${profileName}" with ${overrideCount} overrides: INVALID`);
    for (const err of errors) {
      lines.push(`  • ${err}`);
    }
  }

  for (const warn of allWarnings) {
    lines.push(`⚠️  ${warn}`);
  }

  return {
    output: lines.join('\n'),
    valid,
    errors,
    warnings: allWarnings,
    overrideCount,
  };
}

/**
 * `hexos profile explain <capability>` — Explain a capability in detail.
 *
 * @param {string} capabilityKey - The capability to explain
 * @param {object} [config] - Current config (to show resolved value)
 * @param {object} [options]
 * @param {object} [options.logger] - Logger instance
 * @returns {{ output: string }}
 */
export function profileExplain(capabilityKey, config = null, options = {}) {
  const logger = options.logger || { info() {}, warn() {}, error() {} };

  if (!CAPABILITY_KEYS.includes(capabilityKey)) {
    throw new Error(
      `Unknown capability: "${capabilityKey}".\n` +
      `Valid capabilities: ${CAPABILITY_KEYS.join(', ')}`
    );
  }

  const meta = CAPABILITY_METADATA[capabilityKey];
  const lines = [];

  lines.push(`${meta.name} — ${meta.description}`);
  lines.push(`Layer: ${meta.layer}`);
  lines.push('');

  // Show current resolved value if config provided
  if (config) {
    const profileName = config.profile || 'sovereign';
    const preset = PROFILES[profileName];
    if (preset) {
      const overrides = config.capabilities || {};
      const resolved = overrides[capabilityKey] !== undefined
        ? (STRUCTURED_CAPABILITY_KEYS.includes(capabilityKey)
          ? deepMerge(preset[capabilityKey], overrides[capabilityKey])
          : overrides[capabilityKey])
        : preset[capabilityKey];
      lines.push(`Current value (${profileName}): ${formatCapabilityValue(capabilityKey, resolved)}`);
      lines.push('');
    }
  }

  // Show possible values
  if (meta.values) {
    lines.push('Possible values:');
    for (const [val, desc] of Object.entries(meta.values)) {
      lines.push(`  ${val.padEnd(22)} ${desc}`);
    }
    lines.push('');
  }

  // Show fix hint
  const fix = CAPABILITY_FIX_HINTS[capabilityKey];
  if (fix) {
    lines.push(`Fix hint: ${fix}`);
    lines.push('');
  }

  // Show per-profile values
  lines.push('Profile defaults:');
  for (const pName of PROFILE_NAMES) {
    const preset = PROFILES[pName];
    const val = preset[capabilityKey];
    lines.push(`  ${pName.padEnd(12)} ${formatCapabilityValue(capabilityKey, val)}`);
  }
  lines.push('');

  // Override rules
  lines.push('Override rules:');
  for (const pName of PROFILE_NAMES) {
    const preset = PROFILES[pName];
    const val = preset[capabilityKey];
    let rule;

    if (typeof val === 'boolean') {
      if (val === true) {
        rule = 'can restrict (set to false)';
      } else {
        rule = 'cannot change (locked)';
      }
    } else if (typeof val === 'object' && val !== null) {
      if (val.mode) {
        rule = `can restrict mode, cannot escalate`;
      } else {
        rule = 'can lower limits, cannot raise';
      }
    } else {
      // Enum capability
      rule = 'can restrict (more restrictive values only)';
    }

    lines.push(`  ${pName.padEnd(12)} ${rule}`);
  }

  return { output: lines.join('\n') };
}
