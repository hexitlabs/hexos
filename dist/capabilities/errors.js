/**
 * CapabilityDeniedError — thrown when an action is blocked by the
 * capability gate system.
 *
 * Includes three parts: WHAT was blocked, WHY, and HOW to fix it.
 * See PRD §6 for specification.
 */

/** Fix hints per capability — tells user how to resolve the denial */
export const CAPABILITY_FIX_HINTS = {
  exec: 'Add command to exec.allowlist in capabilities, or use sovereign profile.',
  browser: 'Add domain to browser.navigationAllowlist, or set browser.mode to "full".',
  fileSystem: 'Move file to workspace directory, or set fileSystem to "full".',
  network: 'Configure egress rules, or set network to "unrestricted".',
  selfUpdate: 'Self-update is disabled for this profile. Update via operator admin API.',
  skillInstall: 'Add skill to vetted registry (operator admin API), or use sovereign profile.',
  configEdit: 'Config editing is disabled. Use admin API or hexos profile set.',
  workspaceEdit: 'Workspace editing is disabled for this profile.',
  codeModification: 'Code modification is disabled. Use sovereign profile for full access.',
  agentSpawn: 'Increase costLimits budget, or switch agentSpawn to "unlimited".',
  agentConcurrency: 'Wait for active agents to complete, or increase agentConcurrency.',
  agentToolProfiles: 'Requested tool profile is not available for this deployment profile.',
  agentCapabilityInheritance: 'Profile requires explicit capability declaration for sub-agents.',
  approvalGates: 'Action requires approval. Wait for operator/human approval.',
  auditTrail: 'Audit trail configuration cannot be changed for this profile.',
  leakScanner: 'Leak scanner is enforced for this profile.',
  costLimits: 'Increase costLimits in capabilities, or wait for monthly reset.',
  externalAgentComms: 'External agent communication is disabled for this profile.',
  channelBindings: 'Channel bindings are disabled for this profile.',
  cronScheduling: 'Cron scheduling is disabled for this profile.',
  vaultAccess: 'Vault access is restricted for this profile. Request credentials via operator.',
  httpServer: 'HTTP server is disabled for this profile.',
  adminApi: 'Admin API is disabled for this profile.',
};

export class CapabilityDeniedError extends Error {
  /**
   * @param {string} capability - The capability key that blocked the action
   * @param {string} action - The action that was attempted
   * @param {string} detail - Current capability value or descriptive detail
   * @param {string} [profile] - The active profile name (optional)
   */
  constructor(capability, action, detail, profile) {
    const message = formatDenialMessage(capability, action, detail, profile);
    super(message);
    this.name = 'CapabilityDeniedError';
    this.capability = capability;
    this.action = action;
    this.detail = detail;
    this.profile = profile || null;
  }
}

/**
 * Format a user-facing denial message with what/why/fix.
 *
 * @param {string} capability
 * @param {string} action
 * @param {string} detail
 * @param {string} [profile]
 * @returns {string}
 */
export function formatDenialMessage(capability, action, detail, profile) {
  const lines = [
    `⛔ Action blocked: ${action}`,
    `   Capability: ${capability} = ${detail}`,
  ];

  if (profile) {
    lines.push(`   Profile: ${profile}`);
  }

  const fix = CAPABILITY_FIX_HINTS[capability];
  if (fix) {
    lines.push(`   Fix: ${fix}`);
  }

  return lines.join('\n');
}
