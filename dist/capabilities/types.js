/**
 * HexOS Capability Types — Phase 1 (v0.8.0)
 *
 * Defines the 21 capabilities that control agent behavior across
 * execution, self-modification, agent system, guardrail, and
 * infrastructure layers.
 *
 * Type definitions are enforced at runtime via JSDoc + validation.
 * See PRD §3.2 for full specification.
 */

/**
 * @typedef {'unrestricted' | 'allowlist' | 'disabled'} ExecMode
 */

/**
 * @typedef {Object} ExecCapability
 * @property {ExecMode} mode - Shell command execution mode
 * @property {string[]} [allowlist] - Commands allowed when mode is 'allowlist'
 */

/**
 * @typedef {'full' | 'sandboxed' | 'disabled'} BrowserMode
 */

/**
 * @typedef {Object} BrowserCapability
 * @property {BrowserMode} mode - Browser automation mode
 * @property {string[]} [navigationAllowlist] - Allowed domains when sandboxed
 * @property {boolean} [blockDownloads] - Block file downloads when sandboxed
 * @property {boolean} [blockExtensions] - Disable extension access when sandboxed
 */

/**
 * @typedef {'full' | 'workspace-only' | 'read-only'} FileSystemAccess
 */

/**
 * @typedef {'unrestricted' | 'egress-controlled' | 'internal-only'} NetworkAccess
 */

/**
 * @typedef {'any' | 'vetted-only' | 'disabled'} SkillInstallMode
 */

/**
 * @typedef {'unlimited' | 'budget-limited' | 'operator-approved' | 'disabled'} AgentSpawnMode
 */

/**
 * @typedef {'full' | 'coding' | 'minimal'} AgentToolProfile
 */

/**
 * @typedef {'inherit' | 'profile-default' | 'explicit'} AgentCapabilityInheritance
 */

/**
 * @typedef {'none' | 'external-only' | 'destructive' | 'all'} ApprovalGateMode
 */

/**
 * @typedef {Object} ApprovalGatesCapability
 * @property {ApprovalGateMode} mode - When actions need approval
 * @property {boolean} bypassScheduled - Whether scheduled tasks bypass gates
 */

/**
 * @typedef {'disabled' | 'local' | 'remote'} AuditTrailMode
 */

/**
 * @typedef {Object} CostLimitsCapability
 * @property {number|null} monthlyDollars - Monthly cost limit (null = unlimited)
 * @property {number|null} perSessionDollars - Per-session cost limit (null = unlimited)
 * @property {number|null} perTaskDollars - Per-task cost limit (null = unlimited)
 * @property {number} alertAtPercent - Alert threshold percentage
 */

/**
 * @typedef {'unrestricted' | 'authenticated-only' | 'disabled'} ExternalAgentCommsMode
 */

/**
 * @typedef {'full' | 'read-only' | 'injected-only' | 'disabled'} VaultAccessMode
 */

/**
 * @typedef {'sovereign' | 'operator' | 'managed'} ProfileName
 */

/**
 * @typedef {Object} HexOSCapabilities
 *
 * Execution Layer:
 * @property {ExecCapability} exec - Shell command execution
 * @property {BrowserCapability} browser - Browser automation
 * @property {FileSystemAccess} fileSystem - Filesystem access scope
 * @property {NetworkAccess} network - Outbound network access
 *
 * Self-Modification Layer:
 * @property {boolean} selfUpdate - Can update own HexOS binary
 * @property {SkillInstallMode} skillInstall - Skill/plugin installation
 * @property {boolean} configEdit - Can edit hexos.json
 * @property {boolean} workspaceEdit - Can modify workspace files
 * @property {boolean} codeModification - Can modify HexOS source code
 *
 * Agent System Layer:
 * @property {AgentSpawnMode} agentSpawn - Sub-agent spawning
 * @property {number} agentConcurrency - Max concurrent sub-agents (-1 = unlimited)
 * @property {AgentToolProfile[]} agentToolProfiles - Tool profiles for sub-agents
 * @property {AgentCapabilityInheritance} agentCapabilityInheritance - Inheritance mode
 *
 * Guardrail Layer:
 * @property {ApprovalGatesCapability} approvalGates - Approval gate config
 * @property {AuditTrailMode} auditTrail - Audit trail logging
 * @property {boolean} leakScanner - Leak detection scanner
 * @property {CostLimitsCapability} costLimits - LLM cost limits
 * @property {ExternalAgentCommsMode} externalAgentComms - External agent communication
 *
 * Infrastructure Layer:
 * @property {boolean} channelBindings - Channel bindings enabled
 * @property {boolean} cronScheduling - Cron/heartbeat scheduling
 * @property {VaultAccessMode} vaultAccess - Vault credential access level
 * @property {boolean} httpServer - HTTP gateway server
 * @property {boolean} adminApi - Admin API enabled
 */

/** All valid capability keys (21 total) */
export const CAPABILITY_KEYS = Object.freeze([
  // Execution Layer
  'exec',
  'browser',
  'fileSystem',
  'network',
  // Self-Modification Layer
  'selfUpdate',
  'skillInstall',
  'configEdit',
  'workspaceEdit',
  'codeModification',
  // Agent System Layer
  'agentSpawn',
  'agentConcurrency',
  'agentToolProfiles',
  'agentCapabilityInheritance',
  // Guardrail Layer
  'approvalGates',
  'auditTrail',
  'leakScanner',
  'costLimits',
  'externalAgentComms',
  // Infrastructure Layer
  'channelBindings',
  'cronScheduling',
  'vaultAccess',
  'httpServer',
  'adminApi',
]);

/** Structured (object) capability keys — need deep merge */
export const STRUCTURED_CAPABILITY_KEYS = Object.freeze([
  'exec',
  'browser',
  'approvalGates',
  'costLimits',
]);

/** Array capability keys — replaced, not merged */
export const ARRAY_CAPABILITY_KEYS = Object.freeze([
  'agentToolProfiles',
]);

export {};
