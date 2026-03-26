/**
 * HexOS Profile Presets — Sovereign, Operator, Managed
 *
 * Exact values from PRD §3.3. Each preset defines the default
 * capabilities for a deployment profile.
 */

/** @type {import('./types.js').HexOSCapabilities} */
export const SOVEREIGN = {
  // Execution — everything unlocked
  exec: { mode: 'unrestricted' },
  browser: { mode: 'full' },
  fileSystem: 'full',
  network: 'unrestricted',

  // Self-modification — full control
  selfUpdate: true,
  skillInstall: 'any',
  configEdit: true,
  workspaceEdit: true,
  codeModification: true,

  // Agents — no limits
  agentSpawn: 'unlimited',
  agentConcurrency: -1,
  agentToolProfiles: ['full', 'coding', 'minimal'],
  agentCapabilityInheritance: 'inherit',

  // Guardrails — opt-in only
  approvalGates: { mode: 'none', bypassScheduled: true },
  auditTrail: 'disabled',
  leakScanner: true,
  costLimits: {
    monthlyDollars: null,
    perSessionDollars: null,
    perTaskDollars: null,
    alertAtPercent: 80,
  },
  externalAgentComms: 'unrestricted',

  // Infrastructure — full
  channelBindings: true,
  cronScheduling: true,
  vaultAccess: 'full',
  httpServer: true,
  adminApi: true,
};

/** @type {import('./types.js').HexOSCapabilities} */
export const OPERATOR = {
  // Execution — controlled
  exec: {
    mode: 'allowlist',
    allowlist: [
      'git', 'npm', 'npx', 'node', 'cat', 'ls', 'grep',
      'head', 'tail', 'wc', 'find', 'hexos', 'curl',
    ],
  },
  browser: {
    mode: 'sandboxed',
    navigationAllowlist: [],
    blockDownloads: true,
    blockExtensions: true,
  },
  fileSystem: 'workspace-only',
  network: 'egress-controlled',

  // Self-modification — locked down
  selfUpdate: false,
  skillInstall: 'vetted-only',
  configEdit: false,
  workspaceEdit: true,
  codeModification: false,

  // Agents — budget-limited
  agentSpawn: 'budget-limited',
  agentConcurrency: 20,
  agentToolProfiles: ['coding', 'minimal'],
  agentCapabilityInheritance: 'profile-default',

  // Guardrails — enforced
  approvalGates: { mode: 'external-only', bypassScheduled: true },
  auditTrail: 'remote',
  leakScanner: true,
  costLimits: {
    monthlyDollars: 1000,
    perSessionDollars: 50,
    perTaskDollars: 10,
    alertAtPercent: 80,
  },
  externalAgentComms: 'authenticated-only',

  // Infrastructure — full (control plane)
  channelBindings: true,
  cronScheduling: true,
  vaultAccess: 'full',
  httpServer: true,
  adminApi: true,
};

/** @type {import('./types.js').HexOSCapabilities} */
export const MANAGED = {
  // Execution — minimal
  exec: { mode: 'disabled' },
  browser: { mode: 'disabled' },
  fileSystem: 'workspace-only',
  network: 'egress-controlled',

  // Self-modification — nothing
  selfUpdate: false,
  skillInstall: 'disabled',
  configEdit: false,
  workspaceEdit: true,
  codeModification: false,

  // Agents — disabled
  agentSpawn: 'disabled',
  agentConcurrency: 0,
  agentToolProfiles: ['minimal'],
  agentCapabilityInheritance: 'profile-default',

  // Guardrails — maximum
  approvalGates: { mode: 'all', bypassScheduled: true },
  auditTrail: 'remote',
  leakScanner: true,
  costLimits: {
    monthlyDollars: 100,
    perSessionDollars: 5,
    perTaskDollars: 2,
    alertAtPercent: 70,
  },
  externalAgentComms: 'disabled',

  // Infrastructure — minimal
  channelBindings: false,
  cronScheduling: true,
  vaultAccess: 'injected-only',
  httpServer: false,
  adminApi: false,
};

/** All profile presets indexed by name */
export const PROFILES = {
  sovereign: SOVEREIGN,
  operator: OPERATOR,
  managed: MANAGED,
};

/** Valid profile names */
export const PROFILE_NAMES = /** @type {const} */ (['sovereign', 'operator', 'managed']);
